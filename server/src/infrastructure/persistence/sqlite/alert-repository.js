import { nanoid } from 'nanoid';
import { AlertRepository } from '../../../domain/ports/index.js';

export class SqliteAlertRepository extends AlertRepository {
  constructor(db) { super(); this.db = db; }

  create({ userId, listId = null, level = 'info', title, body = null }) {
    this.db.prepare(
      'INSERT INTO alerts (id, user_id, list_id, level, title, body) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nanoid(), userId, listId, level, title, body);
  }

  findByUser(userId, limit = 100) {
    return this.db.prepare(
      'SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit);
  }

  countUnread(userId) {
    return this.db.prepare('SELECT COUNT(*) n FROM alerts WHERE user_id = ? AND read = 0')
      .get(userId).n;
  }

  markAllRead(userId) {
    this.db.prepare('UPDATE alerts SET read = 1 WHERE user_id = ?').run(userId);
  }
}
