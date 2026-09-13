// SQLite connection + schema + migrations (better-sqlite3).
//
// This is the single place that owns the database handle and DDL. Repositories
// receive this `db` instance via the container. Schema and migrations are kept
// byte-for-byte compatible with the pre-refactor app so the existing
// data/app.db upgrades in place with no data loss.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { config } from '../../../../config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT,
  credits        INTEGER NOT NULL DEFAULT 1000,
  plan           TEXT NOT NULL DEFAULT 'free',
  api_key_hash   TEXT,
  api_key_prefix TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  source      TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  duplicates  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id             TEXT PRIMARY KEY,
  list_id        TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  score          INTEGER,
  classification TEXT,
  status         TEXT,
  signals        TEXT,
  reasons        TEXT,
  recommendation TEXT,
  verified_at    TEXT
);

CREATE TABLE IF NOT EXISTS list_history (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  health     REAL NOT NULL,
  metrics    TEXT NOT NULL,
  counts     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_history_list ON list_history(list_id);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'verify',
  status      TEXT NOT NULL DEFAULT 'queued',
  total       INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  event       TEXT NOT NULL DEFAULT 'job.completed',
  secret      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES lists(id) ON DELETE CASCADE,
  level       TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

CREATE TABLE IF NOT EXISTS schedules (
  list_id       TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  interval_days INTEGER NOT NULL DEFAULT 7,
  next_run      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1
);
`);

// ---- Lightweight column migrations for existing DBs -----------------------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('contacts', 'greylisted', 'greylisted INTEGER DEFAULT 0');
ensureColumn('contacts', 'provider', 'provider TEXT');
ensureColumn('contacts', 'retry_after', 'retry_after TEXT');
ensureColumn('contacts', 'deliverability', 'deliverability TEXT');
ensureColumn('contacts', 'confidence', 'confidence TEXT');
ensureColumn('contacts', 'recommended_action', 'recommended_action TEXT');
ensureColumn('contacts', 'risk_signals', 'risk_signals TEXT');
ensureColumn('users', 'api_key_hash', 'api_key_hash TEXT');
ensureColumn('users', 'api_key_prefix', 'api_key_prefix TEXT');

db.exec('CREATE INDEX IF NOT EXISTS idx_users_apikey ON users(api_key_hash);');

// Migrate any legacy plaintext api_key values to hashed storage.
(() => {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'api_key')) return;
  const legacy = db.prepare(
    "SELECT id, api_key FROM users WHERE api_key IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash = '')"
  ).all();
  if (legacy.length === 0) return;
  const upd = db.prepare('UPDATE users SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const u of legacy) {
      const hash = crypto.createHash('sha256').update(u.api_key).digest('hex');
      upd.run(hash, u.api_key.slice(0, 12), u.id);
    }
  });
  tx();
  console.log(`  Migrated ${legacy.length} legacy API key(s) to hashed storage`);
})();

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
