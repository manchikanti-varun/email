// Persistent, resumable background job queue for bulk verification.
//
// Jobs live in the `jobs` table so an interrupted run resumes from where it
// left off. This service depends only on injected collaborators (repositories,
// the verification engine, the webhook sender) — no direct DB or framework
// coupling. It preserves the original behavior: bounded-concurrency workers,
// progress persisted every 25 contacts, list finalization (health snapshot),
// health-drop alerting, and job.completed / health.dropped webhooks.

import { chooseStableVerdict } from '../../domain/verification/verdict-stability.js';

export class VerificationQueue {
  constructor({
    jobRepository,
    listRepository,
    contactRepository,
    historyRepository,
    alertRepository,
    verificationEngine,
    webhookSender,
    summarize,
    calibrator = null,
    concurrency = 5,
  }) {
    this.jobs = jobRepository;
    this.lists = listRepository;
    this.contacts = contactRepository;
    this.history = historyRepository;
    this.alerts = alertRepository;
    this.engine = verificationEngine;
    this.webhooks = webhookSender;
    this.summarize = summarize;
    // OPTIONAL ML confidence calibrator. Additive; never affects the verdict
    // and never causes a verification to fail.
    this.calibrator = calibrator;
    this.concurrency = concurrency;

    this._running = false;
    this._stopping = false;
  }

  isRunning() { return this._running; }
  requestStop() { this._stopping = true; }

  // Enqueue a verification job and kick the processor.
  enqueue(userId, listId, type = 'verify') {
    const { id } = this.jobs.create({ userId, listId, type });
    this.lists.setStatus(listId, 'verifying');
    this.tick();
    return id;
  }

  // On boot, resume any jobs left running/queued by a previous process.
  resume() {
    const stuck = this.jobs.countUnfinished();
    if (stuck > 0) {
      console.log(`  Resuming ${stuck} interrupted job(s)`);
      this.tick();
    }
  }

  // Process queued jobs one at a time.
  async tick() {
    if (this._running) return;
    this._running = true;
    try {
      for (;;) {
        if (this._stopping) break;
        const job = this.jobs.nextRunnable();
        if (!job) break;
        await this._runJob(job);
      }
    } catch (e) {
      console.error('Queue error:', e.message);
    } finally {
      this._running = false;
    }
  }

  async _runJob(job) {
    this.jobs.markRunning(job.id);

    const pending = this.contacts.findPending(job.list_id, job.type);
    const emails = pending.map((c) => c.email);

    // Warm DNS in the background. Do NOT block the first verifications on a
    // full-domain resolve — that made diverse lists sit at 0% before any work.
    if (emails.length > 0) {
      this.engine.preResolveDomains(emails).catch(() => null);
    }

    let done = job.done || 0;
    let index = 0;
    // Publish progress immediately so the UI leaves "0 / N" as soon as the
    // first contacts finish (previously only every 25 → looked stuck).
    this.jobs.updateProgress(job.id, done);

    // On reverify, preserve a prior CONFIRMED verdict when the fresh probe is
    // only inconclusive (timeout / transport failure). This stops transient
    // network state from flipping a good address to Unknown between runs.
    const isReverify = job.type === 'reverify' || job.type === 'retry';

    const worker = async () => {
      while (index < emails.length) {
        const i = index++;
        try {
          const r = await this.engine.verify(emails[i]);
          if (this.calibrator) {
            try { r.confidenceCalibration = this.calibrator.calibrate(r); } catch { /* ML never breaks verification */ }
          }
          if (isReverify && this.contacts.findVerdict) {
            const prior = this.contacts.findVerdict(pending[i].id);
            const decision = chooseStableVerdict(prior, r);
            if (decision.kept) {
              // Keep the stronger prior verdict; just record it was re-checked
              // so it is not perpetually re-queued.
              try { this.contacts.touchVerified?.(pending[i].id, r.verified_at); } catch { /* non-fatal */ }
              done++;
              this.jobs.updateProgress(job.id, done);
              continue;
            }
          }
          this.contacts.saveResult(pending[i].id, r);
        } catch {
          // leave unverified; a resume will retry it
        }
        done++;
        // Every contact — SQLite updates are cheap vs SMTP wait time.
        this.jobs.updateProgress(job.id, done);
      }
    };

    const n = Math.max(1, Math.min(this.concurrency, emails.length || 1));
    await Promise.all(Array.from({ length: n }, worker));

    this.jobs.markDone(job.id, done);
    this._finalizeList(job);
  }

  _finalizeList(job) {
    const contacts = this.contacts.findByList(job.list_id);
    const summary = this.summarize(contacts);

    this.history.add(job.list_id, summary);
    this.lists.setStatus(job.list_id, 'done');

    this._detectHealthDrop(job, summary);

    const list = this.lists.findById(job.list_id);
    this.webhooks.fire(job.user_id, 'job.completed', {
      jobId: job.id, listId: job.list_id, listName: list?.name,
      health: summary.health, counts: summary.counts, total: summary.total,
    });
  }

  _detectHealthDrop(job, summary) {
    const hist = this.history.latest(job.list_id, 2);
    if (hist.length < 2) return;
    const delta = Math.round((hist[0].health - hist[1].health) * 10) / 10;
    if (delta >= 0) return;

    const list = this.lists.findById(job.list_id);
    const title = `List health decreased by ${Math.abs(delta)} points`;
    const body = `"${list?.name}" dropped from ${hist[1].health} to ${hist[0].health}. ` +
      `Remove: ${summary.counts.remove}, Review: ${summary.counts.review}, Unknown: ${summary.counts.unknown}.`;
    this.alerts.create({
      userId: job.user_id, listId: job.list_id,
      level: delta <= -3 ? 'critical' : 'warning', title, body,
    });
    this.webhooks.fire(job.user_id, 'health.dropped', {
      listId: job.list_id, listName: list?.name, delta, health: hist[0].health,
    });
  }
}
