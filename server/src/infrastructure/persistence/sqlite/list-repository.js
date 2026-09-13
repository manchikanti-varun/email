import { ListRepository } from '../../../domain/ports/index.js';

export class SqliteListRepository extends ListRepository {
  constructor(db) { super(); this.db = db; }

  create(list) {
    this.db.prepare(
      `INSERT INTO lists (id, user_id, name, source, total, duplicates, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(list.id, list.userId, list.name, list.source, list.total, list.duplicates, list.status || 'pending');
    return list;
  }
  findByIdForUser(id, userId) {
    return this.db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(id, userId) || null;
  }
  findById(id) {
    return this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) || null;
  }
  findAllForUser(userId) {
    return this.db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }
  setStatus(id, status) {
    this.db.prepare('UPDATE lists SET status = ? WHERE id = ?').run(status, id);
  }
  updateTotalFromContacts(id) {
    this.db.prepare(
      'UPDATE lists SET total = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?'
    ).run(id, id);
  }
  deleteForUser(id, userId) {
    return this.db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').run(id, userId).changes;
  }
  latestHealth(id) {
    const row = this.db.prepare(
      'SELECT health FROM list_history WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(id);
    return row?.health ?? null;
  }
}
