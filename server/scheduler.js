// Scheduled re-verification (PDF section 8: ongoing monitoring). Periodically
// checks for lists whose next_run is due and enqueues a reverify job, and
// enqueues greylist retries for contacts past their retry_after time.
import { db } from './db.js';
import { enqueueVerify } from './queue.js';

const CHECK_INTERVAL_MS = 60 * 1000; // scan once a minute

function runDueSchedules() {
  const due = db.prepare(
    "SELECT * FROM schedules WHERE enabled = 1 AND next_run <= datetime('now')"
  ).all();
  for (const s of due) {
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(s.list_id);
    if (!list) { db.prepare('DELETE FROM schedules WHERE list_id = ?').run(s.list_id); continue; }
    if (list.status !== 'verifying') {
      enqueueVerify(list.user_id, list.id, 'reverify');
    }
    const next = new Date(Date.now() + s.interval_days * 86400000).toISOString();
    db.prepare('UPDATE schedules SET next_run = ? WHERE list_id = ?').run(next, s.list_id);
  }
}

function runGreylistRetries() {
  // Group due retries by list and enqueue one retry job per list.
  const lists = db.prepare(
    `SELECT DISTINCT list_id FROM contacts
     WHERE retry_after IS NOT NULL AND retry_after <= datetime('now')`
  ).all();
  for (const { list_id } of lists) {
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(list_id);
    if (!list || list.status === 'verifying') continue;
    enqueueVerify(list.user_id, list_id, 'retry');
  }
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    try { runDueSchedules(); runGreylistRetries(); }
    catch (e) { console.error('Scheduler error:', e.message); }
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  console.log('  Scheduler started (re-verification + greylist retries)');
}

export function upsertSchedule(listId, intervalDays, enabled = true) {
  const next = new Date(Date.now() + intervalDays * 86400000).toISOString();
  db.prepare(
    `INSERT INTO schedules (list_id, interval_days, next_run, enabled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(list_id) DO UPDATE SET interval_days=excluded.interval_days,
       next_run=excluded.next_run, enabled=excluded.enabled`
  ).run(listId, intervalDays, next, enabled ? 1 : 0);
}
