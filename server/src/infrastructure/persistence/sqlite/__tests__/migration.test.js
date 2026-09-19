// PHASE 2C — Live SQLite schema/migration tests (initSchema), against temporary
// databases only. Verifies fresh init, legacy-schema upgrade, added columns,
// data preservation, idempotency, restart safety, FK/WAL, legacy api_key
// migration, and webhook secret encryption migration.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { initSchema } from '../schema.js';
import { SqliteWebhookRepository } from '../webhook-repository.js';
import { SecretCipher, resolveKey } from '../../../security/secret-crypto.js';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailhealth-mig-')); });
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

let n = 0;
function freshDb() {
  const p = path.join(dir, `db-${n++}.db`);
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, p };
}
function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

test('fresh database initializes all tables', () => {
  const { db } = freshDb();
  initSchema(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['users', 'lists', 'contacts', 'list_history', 'jobs', 'webhooks', 'alerts', 'schedules', 'agent_audit_logs', 'revoked_tokens']) {
    assert.ok(tables.includes(t), `table ${t} created`);
  }
  db.close();
});

test('fresh init adds the additive columns (contacts + webhooks.secret_enc)', () => {
  const { db } = freshDb();
  initSchema(db);
  const c = columns(db, 'contacts');
  for (const col of ['deliverability', 'confidence', 'mailbox_status', 'verification_quality', 'smtp_evidence', 'acceptance_type', 'calibrated_confidence']) {
    assert.ok(c.includes(col), `contacts.${col} present`);
  }
  assert.ok(columns(db, 'webhooks').includes('secret_enc'), 'webhooks.secret_enc present');
  db.close();
});

test('WAL + foreign_keys remain enabled after init', () => {
  const { db } = freshDb();
  initSchema(db);
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('FK cascade works after init (delete user removes lists/contacts)', () => {
  const { db } = freshDb();
  initSchema(db);
  db.prepare("INSERT INTO users (id,email,password_hash,credits) VALUES ('u1','u1@x.com','h',10)").run();
  db.prepare("INSERT INTO lists (id,user_id,name,total) VALUES ('l1','u1','L',1)").run();
  db.prepare("INSERT INTO contacts (id,list_id,email) VALUES ('c1','l1','a@x.com')").run();
  db.prepare("DELETE FROM users WHERE id='u1'").run();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lists').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contacts').get().n, 0);
  db.close();
});

test('legacy schema upgrade: old tables gain new columns; existing data intact', () => {
  const { db, p } = freshDb();
  // Simulate a PRE-refactor database: minimal legacy tables + a legacy api_key.
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      name TEXT, credits INTEGER NOT NULL DEFAULT 1000, plan TEXT NOT NULL DEFAULT 'free',
      api_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE lists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, source TEXT,
      total INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE contacts (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, email TEXT NOT NULL,
      score INTEGER, classification TEXT, status TEXT, signals TEXT, reasons TEXT, recommendation TEXT, verified_at TEXT);
    CREATE TABLE webhooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'job.completed', secret TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  const rawKey = 'elh_legacyplaintextkey123456';
  db.prepare("INSERT INTO users (id,email,password_hash,credits,api_key) VALUES ('u1','legacy@x.com','h',777,?)").run(rawKey);
  db.prepare("INSERT INTO lists (id,user_id,name,total) VALUES ('l1','u1','Legacy List',3)").run();
  db.prepare("INSERT INTO contacts (id,list_id,email,classification) VALUES ('c1','l1','keep@x.com','safe')").run();

  const { migratedApiKeys } = initSchema(db);

  // New columns added.
  assert.ok(columns(db, 'contacts').includes('mailbox_status'), 'contacts upgraded');
  assert.ok(columns(db, 'users').includes('api_key_hash'), 'users.api_key_hash added');
  assert.ok(columns(db, 'webhooks').includes('secret_enc'), 'webhooks.secret_enc added');

  // Existing data intact.
  const u = db.prepare("SELECT credits, email FROM users WHERE id='u1'").get();
  assert.equal(u.credits, 777);
  assert.equal(u.email, 'legacy@x.com');
  assert.equal(db.prepare("SELECT classification FROM contacts WHERE id='c1'").get().classification, 'safe');

  // Legacy api_key migrated to sha256 hash + 12-char prefix; original preserved in place.
  assert.equal(migratedApiKeys, 1);
  const migrated = db.prepare("SELECT api_key_hash, api_key_prefix FROM users WHERE id='u1'").get();
  assert.equal(migrated.api_key_hash, crypto.createHash('sha256').update(rawKey).digest('hex'));
  assert.equal(migrated.api_key_prefix, rawKey.slice(0, 12));

  db.close();
  fs.rmSync(p, { force: true });
});

test('idempotent: initSchema twice on the same DB is a no-op the second time', () => {
  const { db } = freshDb();
  initSchema(db);
  db.prepare("INSERT INTO users (id,email,password_hash,credits) VALUES ('u1','u@x.com','h',5)").run();
  const first = columns(db, 'contacts').length;
  const second = initSchema(db); // run again
  assert.equal(second.migratedApiKeys, 0, 'no legacy keys to migrate on a modern schema');
  assert.equal(columns(db, 'contacts').length, first, 'no duplicate columns');
  assert.equal(db.prepare("SELECT credits FROM users WHERE id='u1'").get().credits, 5, 'data intact');
  db.close();
});

test('restart safety: reopen a migrated DB file and re-run initSchema — data preserved, no corruption', () => {
  const { db, p } = freshDb();
  initSchema(db);
  db.prepare("INSERT INTO users (id,email,password_hash,credits) VALUES ('u1','r@x.com','h',42)").run();
  db.close();

  // Reopen the same file (simulates a process restart) and re-init.
  const db2 = new Database(p);
  db2.pragma('foreign_keys = ON');
  const res = initSchema(db2);
  assert.equal(res.migratedApiKeys, 0);
  const rows = db2.prepare('SELECT COUNT(*) n FROM users').get().n;
  assert.equal(rows, 1, 'exactly one user (no duplication on restart)');
  assert.equal(db2.prepare("SELECT credits FROM users WHERE id='u1'").get().credits, 42);
  db2.close();
  fs.rmSync(p, { force: true });
});

test('webhook secret migration: legacy plaintext row is encrypted at rest, value preserved', () => {
  const { db } = freshDb();
  initSchema(db);
  db.prepare("INSERT INTO users (id,email,password_hash,credits) VALUES ('u1','w@x.com','h',5)").run();
  // Legacy webhook row with plaintext secret (pre-H2).
  db.prepare("INSERT INTO webhooks (id,user_id,url,event,secret,active) VALUES ('wh','u1','https://h.example.com','job.completed','legacy-secret',1)").run();

  const cipher = new SecretCipher(resolveKey('e'.repeat(64)));
  const repo = new SqliteWebhookRepository(db, cipher);
  const migrated = repo.migratePlaintextSecrets();
  assert.equal(migrated, 1);

  const raw = db.prepare("SELECT secret, secret_enc FROM webhooks WHERE id='wh'").get();
  assert.equal(raw.secret, null, 'plaintext cleared');
  assert.ok(SecretCipher.isEnvelope(raw.secret_enc), 'now encrypted');
  assert.equal(repo.findMatching('u1', 'job.completed')[0].secret, 'legacy-secret', 'value preserved for signing');

  // Idempotent.
  assert.equal(repo.migratePlaintextSecrets(), 0);
  db.close();
});
