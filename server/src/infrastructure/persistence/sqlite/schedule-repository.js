import { ScheduleRepository } from '../../../domain/ports/index.js';

export class SqliteScheduleRepository extends ScheduleRepository {
  constructor(db) { super(); this.db = db; }

  upsert(listId, intervalDays, enabled = true) {
    const next = new Date(Date.now() + intervalDays * 86400000).toISOString();
    this.db.prepare(
      `INSERT INTO schedules (list_id, interval_days, next_run, enabled)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET interval_days=excluded.interval_days,
         next_run=excluded.next_run, enabled=excluded.enabled`
    ).run(listId, intervalDays, next, enabled ? 1 : 0);
  }

  findDue() {
    return this.db.prepare(
      "SELECT * FROM schedules WHERE enabled = 1 AND next_run <= datetime('now')"
    ).all();
  }

  setNextRun(listId, nextRunIso) {
    this.db.prepare('UPDATE schedules SET next_run = ? WHERE list_id = ?').run(nextRunIso, listId);
  }

  delete(listId) {
    this.db.prepare('DELETE FROM schedules WHERE list_id = ?').run(listId);
  }
}
