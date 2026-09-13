import { nanoid } from 'nanoid';
import { JobRepository } from '../../../domain/ports/index.js';

export class SqliteJobRepository extends JobRepository {
  constructor(db) { super(); this.db = db; }

  // Creates a queued job sized to the list's current contact count.
  create({ userId, listId, type = 'verify' }) {
    const id = nanoid();
    const total = this.db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ?').get(listId).n;
    this.db.prepare(
      `INSERT INTO jobs (id, user_id, list_id, type, status, total, done)
       VALUES (?, ?, ?, ?, 'queued', ?, 0)`
    ).run(id, userId, listId, type, total);
    return { id, total };
  }

  nextRunnable() {
    return this.db.prepare(
      "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC LIMIT 1"
    ).get() || null;
  }

  latestForList(listId) {
    return this.db.prepare(
      'SELECT done, total, status FROM jobs WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(listId) || null;
  }

  markRunning(id) {
    this.db.prepare("UPDATE jobs SET status='running', updated_at=datetime('now') WHERE id=?").run(id);
  }
  updateProgress(id, done) {
    this.db.prepare("UPDATE jobs SET done=?, updated_at=datetime('now') WHERE id=?").run(done, id);
  }
  markDone(id, done) {
    this.db.prepare("UPDATE jobs SET done=?, status='done', updated_at=datetime('now') WHERE id=?")
      .run(done, id);
  }
  countUnfinished() {
    return this.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get().n;
  }
}
