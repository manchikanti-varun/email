import { nanoid } from 'nanoid';
import { HistoryRepository } from '../../../domain/ports/index.js';

export class SqliteHistoryRepository extends HistoryRepository {
  constructor(db) { super(); this.db = db; }

  add(listId, snapshot) {
    this.db.prepare(
      'INSERT INTO list_history (id, list_id, health, metrics, counts) VALUES (?, ?, ?, ?, ?)'
    ).run(
      nanoid(), listId, snapshot.health,
      JSON.stringify(snapshot.metrics), JSON.stringify(snapshot.counts)
    );
  }

  // Full ascending history with metrics/counts parsed.
  findByList(listId) {
    return this.db.prepare(
      'SELECT health, metrics, counts, created_at FROM list_history WHERE list_id = ? ORDER BY created_at ASC'
    ).all(listId).map((h) => ({
      ...h,
      metrics: safeParse(h.metrics),
      counts: safeParse(h.counts),
    }));
  }

  // Most recent N snapshots (health only), descending.
  latest(listId, limit = 2) {
    return this.db.prepare(
      'SELECT health FROM list_history WHERE list_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(listId, limit);
  }
}

function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }
