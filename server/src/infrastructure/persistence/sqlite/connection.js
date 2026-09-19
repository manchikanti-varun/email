// SQLite connection (better-sqlite3). Owns the single database handle; the
// schema + migrations live in ./schema.js (initSchema) so the exact same
// initialization can be unit-tested against a temporary database. Schema and
// migrations remain byte-for-byte compatible with the pre-refactor app so the
// existing data/app.db upgrades in place with no data loss.
import Database from 'better-sqlite3';
import { config } from '../../../../config.js';
import { initSchema } from './schema.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initSchema(db, { log: (msg) => console.log(msg) });

// Checkpoint + close, used by graceful shutdown.
export function closeDb() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    return true;
  } catch {
    return false;
  }
}

export default db;
