// Scheduled re-verification + greylist retries. Periodically enqueues reverify
// jobs for lists whose next_run is due, and retry jobs for contacts past their
// retry_after time. Depends only on injected collaborators.

const CHECK_INTERVAL_MS = 60 * 1000;

export class Scheduler {
  constructor({ scheduleRepository, listRepository, contactRepository, queue, revokedTokenRepository = null }) {
    this.schedules = scheduleRepository;
    this.lists = listRepository;
    this.contacts = contactRepository;
    this.queue = queue;
    // Optional: sweep expired JWT-revocation entries so the store stays bounded.
    this.revokedTokens = revokedTokenRepository;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this._runDueSchedules(); this._runGreylistRetries(); this._cleanupRevokedTokens(); }
      catch (e) { console.error('Scheduler error:', e.message); }
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
    console.log('  Scheduler started (re-verification + greylist retries)');
  }

  _cleanupRevokedTokens() {
    if (!this.revokedTokens) return;
    try { this.revokedTokens.cleanupExpired(); }
    catch (e) { console.error('Revoked-token cleanup error:', e.message); }
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _runDueSchedules() {
    const due = this.schedules.findDue();
    for (const s of due) {
      const list = this.lists.findById(s.list_id);
      if (!list) { this.schedules.delete(s.list_id); continue; }
      if (list.status !== 'verifying') {
        this.queue.enqueue(list.user_id, list.id, 'reverify');
      }
      const next = new Date(Date.now() + s.interval_days * 86400000).toISOString();
      this.schedules.setNextRun(s.list_id, next);
    }
  }

  _runGreylistRetries() {
    const listIds = this.contacts.listsWithDueRetries();
    for (const listId of listIds) {
      const list = this.lists.findById(listId);
      if (!list || list.status === 'verifying') continue;
      this.queue.enqueue(list.user_id, listId, 'retry');
    }
  }
}
