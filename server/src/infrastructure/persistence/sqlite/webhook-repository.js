import { nanoid } from 'nanoid';
import { WebhookRepository } from '../../../domain/ports/index.js';

export class SqliteWebhookRepository extends WebhookRepository {
  constructor(db) { super(); this.db = db; }

  // Public listing (no secret exposed).
  findByUser(userId) {
    return this.db.prepare(
      'SELECT id, url, event, active, created_at FROM webhooks WHERE user_id = ?'
    ).all(userId);
  }

  // Active hooks matching an event (or wildcard) — includes secret for signing.
  findMatching(userId, event) {
    return this.db.prepare(
      "SELECT * FROM webhooks WHERE user_id = ? AND active = 1 AND (event = ? OR event = '*')"
    ).all(userId, event);
  }

  create({ userId, url, event = 'job.completed', secret = null }) {
    const id = nanoid();
    this.db.prepare(
      'INSERT INTO webhooks (id, user_id, url, event, secret) VALUES (?, ?, ?, ?, ?)'
    ).run(id, userId, url, event, secret);
    return { id, url, event };
  }

  deleteForUser(id, userId) {
    return this.db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId).changes;
  }
}
