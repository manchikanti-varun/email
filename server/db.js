// SQLite database setup + schema. Zero external service required.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { config } from './config.js';

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
  api_key_hash   TEXT,   -- SHA-256 of the API key (never stored in plaintext)
  api_key_prefix TEXT,   -- short prefix shown in the UI, e.g. elh_ABCD
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  source      TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  duplicates  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | verifying | done
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id             TEXT PRIMARY KEY,
  list_id        TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  score          INTEGER,
  classification TEXT,            -- safe | review | remove | unknown
  status         TEXT,            -- deliverable | undeliverable | risky | unknown
  signals        TEXT,            -- JSON array of signal objects
  reasons        TEXT,            -- JSON array of human explanations
  recommendation TEXT,
  verified_at    TEXT
);

CREATE TABLE IF NOT EXISTS list_history (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  health     REAL NOT NULL,
  metrics    TEXT NOT NULL,       -- JSON of supporting metrics
  counts     TEXT NOT NULL,       -- JSON of classification counts
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_history_list ON list_history(list_id);

-- Background verification jobs (resumable across restarts).
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'verify', -- verify | reverify | retry
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  total       INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Per-user webhook endpoints (PDF section 10).
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  event       TEXT NOT NULL DEFAULT 'job.completed', -- job.completed | health.dropped | *
  secret      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alerts feed (health drops, newly-invalid, etc. — PDF section 8).
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES lists(id) ON DELETE CASCADE,
  level       TEXT NOT NULL DEFAULT 'info', -- info | warning | critical
  title       TEXT NOT NULL,
  body        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

-- Scheduled re-verification config per list (PDF section 8 monitoring).
CREATE TABLE IF NOT EXISTS schedules (
  list_id     TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  interval_days INTEGER NOT NULL DEFAULT 7,
  next_run    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1
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

// Independent scoring dimensions (Evidence -> Confidence -> Action model).
ensureColumn('contacts', 'deliverability', 'deliverability TEXT');       // deliverable|undeliverable|risky|unknown
ensureColumn('contacts', 'confidence', 'confidence TEXT');               // high|medium|low|unknown
ensureColumn('contacts', 'recommended_action', 'recommended_action TEXT'); // keep|review|remove|reverify
ensureColumn('contacts', 'risk_signals', 'risk_signals TEXT');           // JSON array

// API keys are hashed at rest; keep a short plaintext prefix for display.
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

export default db;
