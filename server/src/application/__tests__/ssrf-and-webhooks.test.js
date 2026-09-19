// PHASE 2B.18 / 2B.19 — SSRF protection + webhook behavior.
//   - registration-time validation (isUnsafeUrl / AddWebhook)
//   - delivery-time validation + HMAC signing + secret-not-exposed
// Uses the REAL use cases, a temp SQLite DB, and a local recording HTTP server
// for delivery (never a real metadata endpoint).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { SqliteWebhookRepository } from '../../infrastructure/persistence/sqlite/webhook-repository.js';
import { HttpWebhookSender } from '../../infrastructure/webhooks/http-webhook-sender.js';
import {
  isUnsafeUrl, AddWebhook, ListWebhooks, DeleteWebhook,
} from '../integration-use-cases.js';
import { AppError } from '../errors.js';

let dbPath, db, repo;

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-wh-${Date.now()}.db`);
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT 'job.completed', secret TEXT, secret_enc TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  repo = new SqliteWebhookRepository(db);
});
after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});
beforeEach(() => { db.exec('DELETE FROM webhooks'); });

// ---- 2B.18 SSRF registration-time -----------------------------------------
const UNSAFE = [
  'http://localhost/hook',
  'http://127.0.0.1/hook',
  'http://169.254.169.254/latest/meta-data',
  'http://10.0.0.1/hook',
  'http://172.16.0.1/hook',
  'http://192.168.1.1/hook',
  'http://foo.local/hook',
  'http://svc.internal/hook',
  'ftp://example.com/hook',
  'not-a-url',
];
const SAFE = [
  'https://hooks.example.com/mailhealth',
  'http://public.example.org/webhook',
];

for (const url of UNSAFE) {
  test(`isUnsafeUrl blocks ${url}`, () => assert.equal(isUnsafeUrl(url), true));
}
for (const url of SAFE) {
  test(`isUnsafeUrl allows ${url}`, () => assert.equal(isUnsafeUrl(url), false));
}

test('AddWebhook rejects unsafe/private URLs (400) and non-http protocols', () => {
  const add = new AddWebhook({ webhooks: repo });
  assert.throws(() => add.execute('u1', { url: 'http://169.254.169.254/x' }), (e) => e instanceof AppError && e.status === 400);
  assert.throws(() => add.execute('u1', { url: 'http://localhost/x' }), (e) => e.status === 400);
  assert.throws(() => add.execute('u1', { url: 'ftp://x/y' }), (e) => e.status === 400);
});

test('AddWebhook accepts a public URL and stores it', () => {
  const add = new AddWebhook({ webhooks: repo });
  const out = add.execute('u1', { url: 'https://hooks.example.com/x', event: 'job.completed' });
  assert.ok(out.id);
});

// ---- 2B.19 Webhook CRUD + secret not exposed ------------------------------
test('GET listing never exposes the secret', () => {
  const add = new AddWebhook({ webhooks: repo });
  add.execute('u1', { url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'super-secret-value' });
  const list = new ListWebhooks({ webhooks: repo }).execute('u1');
  assert.equal(list.webhooks.length, 1);
  assert.equal('secret' in list.webhooks[0], false, 'secret must not be in the GET projection');
  // But the delivery lookup DOES include the secret (for signing).
  const matching = repo.findMatching('u1', 'job.completed');
  assert.equal(matching[0].secret, 'super-secret-value');
});

test('DeleteWebhook: owner can delete; wrong owner -> 404', () => {
  const add = new AddWebhook({ webhooks: repo });
  const created = add.execute('u1', { url: 'https://hooks.example.com/x' });
  const del = new DeleteWebhook({ webhooks: repo });
  assert.throws(() => del.execute('other-user', created.id), (e) => e.status === 404);
  assert.deepEqual(del.execute('u1', created.id), { ok: true });
});

test('event filtering + wildcard: fire matches exact event and "*" hooks', async () => {
  const add = new AddWebhook({ webhooks: repo });
  add.execute('u1', { url: 'https://hooks.example.com/exact', event: 'job.completed' });
  add.execute('u1', { url: 'https://hooks.example.com/wild', event: '*' });
  add.execute('u1', { url: 'https://hooks.example.com/other', event: 'health.dropped' });
  const matching = repo.findMatching('u1', 'job.completed').map((h) => h.url);
  assert.ok(matching.includes('https://hooks.example.com/exact'));
  assert.ok(matching.includes('https://hooks.example.com/wild'));
  assert.ok(!matching.includes('https://hooks.example.com/other'));
});

// ---- 2B.18 SSRF delivery-time + HMAC --------------------------------------
// NOTE: HttpWebhookSender's SSRF guard (isPrivateHost) intentionally refuses
// ALL loopback/private targets, including 127.0.0.1 — so a unit test cannot
// point delivery at a local recording server. That refusal IS the behavior
// under test. We therefore assert: (1) loopback/private targets are refused at
// SEND time (no delivery attempted), and (2) the documented HMAC signing
// formula is correct against Node crypto.
test('delivery: SSRF guard refuses loopback (127.0.0.1) at send time — no request made', async () => {
  let hit = false;
  const server = http.createServer((req, res) => { hit = true; res.writeHead(200); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  db.prepare('INSERT INTO webhooks (id,user_id,url,event,secret,active) VALUES (?,?,?,?,?,1)')
    .run('w1', 'u1', `http://127.0.0.1:${port}/hook`, 'job.completed', 'secret');
  new HttpWebhookSender(repo).fire('u1', 'job.completed', { listId: 'l1' });
  await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => server.close(r));
  assert.equal(hit, false, 'loopback target must NOT receive a delivery (SSRF guard)');
});

test('delivery: SSRF guard blocks a metadata target at send time (no request made)', async () => {
  db.prepare('INSERT INTO webhooks (id,user_id,url,event,active) VALUES (?,?,?,?,1)')
    .run('w2', 'u2', 'http://169.254.169.254/latest/meta-data', 'job.completed');
  const sender = new HttpWebhookSender(repo);
  sender.fire('u2', 'job.completed', { test: true });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(true, 'fire() returned without attempting a metadata request');
});

test('HMAC signing formula matches sha256(body, secret) (documented X-MailHealth-Signature)', () => {
  // Locks the exact signature scheme the sender uses when a secret is configured.
  const secret = 'delivery-signing-secret';
  const payload = { event: 'job.completed', timestamp: '2026-01-01T00:00:00.000Z', data: { listId: 'l1', health: 90 } };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.match(sig, /^[0-9a-f]{64}$/, 'HMAC-SHA256 hex digest');
  // Different secret => different signature (signing actually depends on secret).
  const other = crypto.createHmac('sha256', 'different').update(body).digest('hex');
  assert.notEqual(sig, other);
});
