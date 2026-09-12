// Persistent, resumable background job queue for bulk verification.
//
// Jobs live in the `jobs` table so an interrupted run (server restart) resumes
// from where it left off: only contacts that are still unverified (or due for
// a greylist retry) are processed. Verification progress is written to the DB
// so the UI can poll it and it survives restarts.
import { nanoid } from 'nanoid';
import { db } from './db.js';
import { config } from './config.js';
import { verifyEmail } from './verify/engine.js';
import { summarize } from './verify/health.js';
import { fireWebhooks } from './webhooks.js';

let running = false;
let stopping = false;

export function isQueueRunning() { return running; }
export function requestQueueStop() { stopping = true; }

const updateContact = db.prepare(
  `UPDATE contacts SET score=?, classification=?, status=?, signals=?, reasons=?,
     recommendation=?, greylisted=?, provider=?, retry_after=?,
     deliverability=?, confidence=?, recommended_action=?, risk_signals=?,
     verified_at=? WHERE id=?`
);

export function enqueueVerify(userId, listId, type = 'verify') {
  const id = nanoid();
  const total = db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ?').get(listId).n;
  db.prepare(
    `INSERT INTO jobs (id, user_id, list_id, type, status, total, done)
     VALUES (?, ?, ?, ?, 'queued', ?, 0)`
  ).run(id, userId, listId, type, total);
  db.prepare("UPDATE lists SET status = 'verifying' WHERE id = ?").run(listId);
  tick();
  return id;
}

// Selects which contacts a job still needs to process.
function pendingContacts(job) {
  if (job.type === 'retry') {
    // Only greylisted / due-for-retry contacts.
    return db.prepare(
      `SELECT id, email FROM contacts
       WHERE list_id = ? AND (retry_after IS NOT NULL AND retry_after <= datetime('now'))`
    ).all(job.list_id);
  }
  if (job.type === 'reverify') {
    return db.prepare('SELECT id, email FROM contacts WHERE list_id = ?').all(job.list_id);
  }
  // Fresh verify: anything not yet verified (resumable).
  return db.prepare(
    'SELECT id, email FROM contacts WHERE list_id = ? AND verified_at IS NULL'
  ).all(job.list_id);
}

async function runJob(job) {
  db.prepare("UPDATE jobs SET status='running', updated_at=datetime('now') WHERE id=?").run(job.id);

  const contacts = pendingContacts(job);
  const emails = contacts.map((c) => c.email);
  let done = job.done || 0;

  // Bounded-concurrency workers.
  let index = 0;
  const persist = db.transaction((r, contactId) => {
    const retryAfter = r.greylisted
      ? new Date(Date.now() + 30 * 60 * 1000).toISOString() // retry in 30 min
      : null;
    updateContact.run(
      r.score, r.classification, r.status,
      JSON.stringify(r.signals), JSON.stringify(r.reasons),
      r.recommendation, r.greylisted ? 1 : 0, r.provider, retryAfter,
      r.deliverability, r.confidence, r.recommendedAction,
      JSON.stringify(r.riskSignals || []),
      r.verified_at, contactId
    );
  });

  async function worker() {
    while (index < emails.length) {
      const i = index++;
      try {
        const r = await verifyEmail(emails[i]);
        persist(r, contacts[i].id);
      } catch {
        // leave unverified; a resume will retry it
      }
      done++;
      if (done % 5 === 0 || done === emails.length + (job.done || 0)) {
        db.prepare("UPDATE jobs SET done=?, updated_at=datetime('now') WHERE id=?").run(done, job.id);
      }
    }
  }

  const n = Math.max(1, Math.min(config.verifyConcurrency, emails.length || 1));
  await Promise.all(Array.from({ length: n }, worker));

  db.prepare("UPDATE jobs SET done=?, status='done', updated_at=datetime('now') WHERE id=?")
    .run(done, job.id);

  finalizeList(job);
}

function finalizeList(job) {
  const rows = db.prepare('SELECT * FROM contacts WHERE list_id = ?').all(job.list_id);
  const contacts = rows.map((r) => ({ ...r, signals: safeParse(r.signals), reasons: safeParse(r.reasons) }));
  const summary = summarize(contacts);

  // Snapshot history.
  db.prepare(
    `INSERT INTO list_history (id, list_id, health, metrics, counts) VALUES (?, ?, ?, ?, ?)`
  ).run(nanoid(), job.list_id, summary.health, JSON.stringify(summary.metrics), JSON.stringify(summary.counts));

  db.prepare("UPDATE lists SET status='done' WHERE id=?").run(job.list_id);

  // Health-drop alerting + webhooks (monitoring, sections 7-8, 10).
  detectHealthDrop(job, summary);

  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(job.list_id);
  fireWebhooks(job.user_id, 'job.completed', {
    jobId: job.id, listId: job.list_id, listName: list?.name,
    health: summary.health, counts: summary.counts, total: summary.total,
  });
}

function detectHealthDrop(job, summary) {
  const hist = db.prepare(
    'SELECT health FROM list_history WHERE list_id = ? ORDER BY created_at DESC LIMIT 2'
  ).all(job.list_id);
  if (hist.length < 2) return;
  const delta = Math.round((hist[0].health - hist[1].health) * 10) / 10;
  if (delta < 0) {
    const list = db.prepare('SELECT name FROM lists WHERE id=?').get(job.list_id);
    const title = `List health decreased by ${Math.abs(delta)} points`;
    const body = `"${list?.name}" dropped from ${hist[1].health} to ${hist[0].health}. ` +
      `Remove: ${summary.counts.remove}, Review: ${summary.counts.review}, Unknown: ${summary.counts.unknown}.`;
    db.prepare(
      `INSERT INTO alerts (id, user_id, list_id, level, title, body) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), job.user_id, job.list_id, delta <= -3 ? 'critical' : 'warning', title, body);
    fireWebhooks(job.user_id, 'health.dropped', {
      listId: job.list_id, listName: list?.name, delta, health: hist[0].health,
    });
  }
}

// Process queued jobs one at a time.
export async function tick() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (stopping) break; // stop picking up new jobs during shutdown
      const job = db.prepare(
        "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1"
      ).get();
      if (!job) break;
      await runJob(job);
    }
  } catch (e) {
    console.error('Queue error:', e.message);
  } finally {
    running = false;
  }
}

// On boot, resume any jobs left running/queued by a previous process.
export function resumeJobs() {
  const stuck = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get().n;
  if (stuck > 0) {
    console.log(`  Resuming ${stuck} interrupted job(s)`);
    tick();
  }
}

function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }
