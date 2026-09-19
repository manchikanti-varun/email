// PHASE 2C H2 — Webhook secret encryption at rest.
//  - SecretCipher (AES-256-GCM) round-trip, tamper detection, fail-closed.
//  - Repository stores ciphertext (no plaintext in DB), decrypts for delivery.
//  - HMAC signing still matches the documented formula after decryption.
//  - Migration of legacy plaintext secrets is idempotent.
//  - Missing production key fails safely.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import {
  SecretCipher, createSecretCipher, resolveKey, deriveDevKey,
} from '../secret-crypto.js';
import { SqliteWebhookRepository } from '../../persistence/sqlite/webhook-repository.js';

const KEY_HEX = 'a'.repeat(64); // 32 bytes of 0xaa
function cipher() { return new SecretCipher(resolveKey(KEY_HEX)); }

// ---- SecretCipher unit -----------------------------------------------------
test('encrypt/decrypt round-trips and produces a versioned envelope', () => {
  const c = cipher();
  const env = c.encrypt('my-signing-secret');
  assert.ok(env.startsWith('v1:'), 'versioned envelope');
  assert.equal(env.split(':').length, 4, 'v1:iv:tag:ct');
  assert.doesNotMatch(env, /my-signing-secret/, 'plaintext not present in envelope');
  assert.equal(c.decrypt(env), 'my-signing-secret');
});

test('each encryption uses a fresh IV (ciphertext differs for same input)', () => {
  const c = cipher();
  assert.notEqual(c.encrypt('same'), c.encrypt('same'));
});

test('tampered ciphertext fails authentication (throws)', () => {
  const c = cipher();
  const env = c.encrypt('secret');
  const parts = env.split(':');
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] ^= 0xff; // flip a bit
  parts[3] = ct.toString('base64');
  assert.throws(() => c.decrypt(parts.join(':')));
});

test('wrong key cannot decrypt (fail closed)', () => {
  const env = cipher().encrypt('secret');
  const other = new SecretCipher(resolveKey('b'.repeat(64)));
  assert.throws(() => other.decrypt(env));
});

test('resolveKey accepts 64-hex and 32-byte base64; rejects junk', () => {
  assert.equal(resolveKey('a'.repeat(64)).length, 32);
  assert.equal(resolveKey(crypto.randomBytes(32).toString('base64')).length, 32);
  assert.equal(resolveKey('too-short'), null);
  assert.equal(resolveKey(''), null);
  assert.equal(resolveKey(null), null);
});

test('createSecretCipher: prod without a key FAILS (throws); dev derives a key', () => {
  assert.throws(() => createSecretCipher({ key: '', isProd: true }), /required in production/i);
  const dev = createSecretCipher({ key: '', devFallbackPassphrase: 'jwt', isProd: false });
  assert.ok(dev instanceof SecretCipher);
  assert.equal(dev.derived, true);
  // Explicit key is preferred and marked non-derived.
  const explicit = createSecretCipher({ key: KEY_HEX, isProd: true });
  assert.equal(explicit.derived, false);
});

test('deriveDevKey is deterministic and 32 bytes', () => {
  assert.deepEqual(deriveDevKey('x'), deriveDevKey('x'));
  assert.equal(deriveDevKey('x').length, 32);
  assert.notDeepEqual(deriveDevKey('x'), deriveDevKey('y'));
});

// ---- Repository encryption-at-rest ----------------------------------------
let dbPath, db, repo;
before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-wh-enc-${Date.now()}.db`);
  db = new Database(dbPath);
  db.exec(`CREATE TABLE webhooks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL,
    event TEXT NOT NULL DEFAULT 'job.completed', secret TEXT, secret_enc TEXT,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  repo = new SqliteWebhookRepository(db, cipher());
});
after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});
beforeEach(() => { db.exec('DELETE FROM webhooks'); });

test('create stores ciphertext only — no plaintext secret in the database', () => {
  repo.create({ userId: 'u1', url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'plain-secret-123' });
  const raw = db.prepare('SELECT secret, secret_enc FROM webhooks WHERE user_id = ?').get('u1');
  assert.equal(raw.secret, null, 'plaintext column must be NULL');
  assert.ok(SecretCipher.isEnvelope(raw.secret_enc), 'secret stored as encryption envelope');
  assert.doesNotMatch(raw.secret_enc, /plain-secret-123/, 'plaintext never appears in ciphertext');
});

test('findMatching decrypts the secret for delivery; findByUser never exposes it', () => {
  repo.create({ userId: 'u1', url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'sign-me' });
  const matching = repo.findMatching('u1', 'job.completed');
  assert.equal(matching[0].secret, 'sign-me', 'decrypted for signing');
  const listed = repo.findByUser('u1');
  assert.equal('secret' in listed[0], false);
  assert.equal('secret_enc' in listed[0], false);
});

test('HMAC signing matches after decryption (documented formula preserved)', () => {
  repo.create({ userId: 'u1', url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'hmac-secret' });
  const secret = repo.findMatching('u1', 'job.completed')[0].secret;
  const body = JSON.stringify({ event: 'job.completed', data: { listId: 'l1' } });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const expected = crypto.createHmac('sha256', 'hmac-secret').update(body).digest('hex');
  assert.equal(sig, expected, 'HMAC over the decrypted secret equals HMAC over the original');
});

test('wrong secret produces a different HMAC (verification would fail)', () => {
  repo.create({ userId: 'u1', url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'right' });
  const secret = repo.findMatching('u1', 'job.completed')[0].secret;
  const body = 'payload';
  const good = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const bad = crypto.createHmac('sha256', 'wrong').update(body).digest('hex');
  assert.notEqual(good, bad);
});

test('a webhook with no secret stores NULL and returns null secret', () => {
  repo.create({ userId: 'u1', url: 'https://hooks.example.com/x', event: 'job.completed' });
  const raw = db.prepare('SELECT secret, secret_enc FROM webhooks WHERE user_id = ?').get('u1');
  assert.equal(raw.secret, null);
  assert.equal(raw.secret_enc, null);
  assert.equal(repo.findMatching('u1', 'job.completed')[0].secret, null);
});

// ---- Migration of legacy plaintext ----------------------------------------
test('migratePlaintextSecrets encrypts legacy rows, is idempotent, and preserves the value', () => {
  // Simulate a legacy row written before H2 (plaintext in `secret`).
  db.prepare("INSERT INTO webhooks (id,user_id,url,event,secret,active) VALUES ('leg','u1','https://h.example.com','job.completed','legacy-secret',1)").run();

  const migrated = repo.migratePlaintextSecrets();
  assert.equal(migrated, 1, 'one legacy row migrated');

  const raw = db.prepare('SELECT secret, secret_enc FROM webhooks WHERE id = ?').get('leg');
  assert.equal(raw.secret, null, 'plaintext cleared after migration');
  assert.ok(SecretCipher.isEnvelope(raw.secret_enc), 'now encrypted');

  // Value preserved and decryptable for delivery.
  assert.equal(repo.findMatching('u1', 'job.completed')[0].secret, 'legacy-secret');

  // Idempotent: a second run migrates nothing.
  assert.equal(repo.migratePlaintextSecrets(), 0, 'idempotent');
});

test('decryption failure fails closed at read time (wrong-key envelope)', () => {
  // Insert an envelope encrypted with a DIFFERENT key.
  const foreign = new SecretCipher(resolveKey('c'.repeat(64))).encrypt('x');
  db.prepare("INSERT INTO webhooks (id,user_id,url,event,secret,secret_enc,active) VALUES ('bad','u1','https://h.example.com','job.completed',NULL,?,1)").run(foreign);
  assert.throws(() => repo.findMatching('u1', 'job.completed'), 'read must fail closed on wrong-key ciphertext');
});
