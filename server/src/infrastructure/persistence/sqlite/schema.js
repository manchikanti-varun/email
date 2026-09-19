// SQLite schema + migrations, extracted from connection.js so the exact same
// initialization can be exercised against a temporary database in tests. This
// is pure DDL/migration logic over a passed-in `db` handle — it opens no file
// and reads no config. connection.js calls initSchema(db) on the real handle.
//
// Behavior is byte-for-byte identical to the pre-extraction inline code:
// idempotent CREATE TABLE IF NOT EXISTS, additive ensureColumn migrations, and
// the one-time legacy plaintext api_key -> sha256 hash migration.
import crypto from 'node:crypto';

const SCHEMA_SQL = `
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

-- AI Agent audit log. One row per tool invocation the agent performs. Stores
-- WHO, WHAT and the OUTCOME for accountability. Never stores secrets
-- (passwords, API keys, tokens) — arguments are redacted before persistence.
CREATE TABLE IF NOT EXISTS agent_audit_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  user_request    TEXT,
  tool_name       TEXT NOT NULL,
  tool_args       TEXT,
  permission      TEXT NOT NULL DEFAULT 'read',
  status          TEXT NOT NULL DEFAULT 'ok',
  confirmed       INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_user ON agent_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_conv ON agent_audit_logs(conversation_id);

-- Revoked JWT identifiers (logout / token revocation). We store only the
-- token's unique id (jti) and the instant it naturally expires, so the table
-- can be swept clean once tokens are past expiry. No token material, no user
-- secrets. A revoked jti fails authentication until it is cleaned up (after
-- which the underlying token has expired anyway).
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT PRIMARY KEY,
  user_id     TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);

-- AI List Health Analysis (one latest row per list). Stores the deterministic
-- health score/level + aggregate metrics + the (deterministic or AI) diagnosis,
-- so an analysis is reproducible and cheap to re-display without re-running the
-- LLM. No secrets, no prompts, no raw addresses are stored here.
CREATE TABLE IF NOT EXISTS list_analysis (
  list_id       TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  health_score  REAL NOT NULL,
  health_level  TEXT NOT NULL,
  metrics       TEXT NOT NULL,   -- JSON: deterministic list-health report
  diagnosis     TEXT,            -- JSON: { summary, keyIssues, recommendations, observations }
  diagnosis_source TEXT,         -- 'ai' | 'deterministic'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_list_analysis_user ON list_analysis(user_id);
`;

// Add a column only if it does not already exist (idempotent).
function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// One-time migration of legacy plaintext api_key values to hashed storage.
// Returns the number of rows migrated (0 when no legacy column/rows exist).
function migrateLegacyApiKeys(db, log) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'api_key')) return 0;
  const legacy = db.prepare(
    "SELECT id, api_key FROM users WHERE api_key IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash = '')"
  ).all();
  if (legacy.length === 0) return 0;
  const upd = db.prepare('UPDATE users SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const u of legacy) {
      const hash = crypto.createHash('sha256').update(u.api_key).digest('hex');
      upd.run(hash, u.api_key.slice(0, 12), u.id);
    }
  });
  tx();
  if (log) log(`  Migrated ${legacy.length} legacy API key(s) to hashed storage`);
  return legacy.length;
}

/**
 * Initialize (create + migrate) the schema on an already-open db handle.
 * Idempotent: safe to run repeatedly against a fresh OR existing database.
 * @param {import('better-sqlite3').Database} db
 * @param {{ log?: (msg:string)=>void }} [opts]
 * @returns {{ migratedApiKeys: number }}
 */
export function initSchema(db, { log = null } = {}) {
  db.exec(SCHEMA_SQL);

  // Additive column migrations for pre-existing databases.
  ensureColumn(db, 'contacts', 'greylisted', 'greylisted INTEGER DEFAULT 0');
  ensureColumn(db, 'contacts', 'provider', 'provider TEXT');
  ensureColumn(db, 'contacts', 'retry_after', 'retry_after TEXT');
  ensureColumn(db, 'contacts', 'deliverability', 'deliverability TEXT');
  ensureColumn(db, 'contacts', 'confidence', 'confidence TEXT');
  ensureColumn(db, 'contacts', 'recommended_action', 'recommended_action TEXT');
  ensureColumn(db, 'contacts', 'risk_signals', 'risk_signals TEXT');
  // ML Confidence Calibration (additive; nullable). Stores the calibrated
  // reliability estimate WITHOUT ever altering the deterministic verdict columns.
  ensureColumn(db, 'contacts', 'calibrated_confidence', 'calibrated_confidence REAL');
  ensureColumn(db, 'contacts', 'calibration_level', 'calibration_level TEXT');
  ensureColumn(db, 'contacts', 'calibration_model', 'calibration_model TEXT');
  // Additive mailbox proof + evidence quality (never alter legacy deliverability).
  ensureColumn(db, 'contacts', 'mailbox_status', 'mailbox_status TEXT');
  ensureColumn(db, 'contacts', 'verification_quality', 'verification_quality TEXT');
  ensureColumn(db, 'contacts', 'smtp_evidence', 'smtp_evidence TEXT');
  ensureColumn(db, 'contacts', 'acceptance_type', 'acceptance_type TEXT');
  ensureColumn(db, 'users', 'api_key_hash', 'api_key_hash TEXT');
  ensureColumn(db, 'users', 'api_key_prefix', 'api_key_prefix TEXT');
  // Webhook secret encryption-at-rest (H2). Legacy `secret` (plaintext) stays
  // readable during migration; `secret_enc` stores the AES-256-GCM envelope.
  ensureColumn(db, 'webhooks', 'secret_enc', 'secret_enc TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_users_apikey ON users(api_key_hash);');

  const migratedApiKeys = migrateLegacyApiKeys(db, log);
  return { migratedApiKeys };
}
