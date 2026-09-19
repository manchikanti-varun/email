// PHASE 2C H1 — JWT revocation on logout.
// Unit-level coverage of the token service + revocation repository + the auth
// middleware/logout flow, exercised through a minimal real Express app (no full
// container, no production DB). Temp SQLite only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';

import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { Sha256ApiKeyService } from '../../../infrastructure/security/api-key-service.js';
import { SqliteRevokedTokenRepository } from '../../../infrastructure/persistence/sqlite/revoked-token-repository.js';
import { makeAuthMiddleware, makeCookieHelpers } from '../middleware.js';
import { makeAuthRouter } from '../routes/auth-routes.js';

const SECRET = 'phase2c-revocation-secret-that-is-long-enough-1234567890';
let dbPath, db, revokedTokens, tokens, apiKeys, users;

function makeUsers() {
  const rows = new Map();
  return {
    _add(u) { rows.set(u.id, u); return u; },
    findById: (id) => rows.get(id) || null,
    findByApiKeyHash: () => null,
  };
}

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-revoke-${Date.now()}.db`);
  db = new Database(dbPath);
  db.exec(`CREATE TABLE revoked_tokens (
    jti TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  revokedTokens = new SqliteRevokedTokenRepository(db);
  tokens = new JwtTokenService(SECRET);
  apiKeys = new Sha256ApiKeyService();
});
after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});
beforeEach(() => { db.exec('DELETE FROM revoked_tokens'); users = makeUsers(); });

// Build a tiny app: a protected route + the real logout route.
function makeApp({ revokedStore = revokedTokens } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const authRequired = makeAuthMiddleware({ users, tokenService: tokens, apiKeyService: apiKeys, revokedTokens: revokedStore });
  const cookies = makeCookieHelpers({ cookie: { secure: false, sameSite: 'lax' } });
  app.use('/api/auth', makeAuthRouter({
    registerUser: { execute: () => ({}) }, loginUser: { execute: () => ({}) },
    rotateApiKey: { execute: () => ({}) }, authRequired, cookies,
    tokenService: tokens, revokedTokens: revokedStore,
  }));
  app.get('/api/protected', authRequired, (req, res) => res.json({ ok: true, user: req.user.id }));
  return app;
}
async function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

// ---- token service unit ----------------------------------------------------
test('sign() embeds a unique jti; verifyDetailed returns userId+jti+exp', () => {
  const t1 = tokens.sign({ id: 'u1' });
  const t2 = tokens.sign({ id: 'u1' });
  const d1 = tokens.verifyDetailed(t1);
  const d2 = tokens.verifyDetailed(t2);
  assert.equal(d1.userId, 'u1');
  assert.ok(d1.jti && d2.jti && d1.jti !== d2.jti, 'each token gets a distinct jti');
  assert.equal(typeof d1.exp, 'number');
  assert.equal(tokens.verify(t1), 'u1'); // backward-compatible
});

test('verifyDetailed returns null for malformed/expired tokens', () => {
  assert.equal(tokens.verifyDetailed('garbage.token'), null);
  const shortLived = new JwtTokenService(SECRET, '-1s').sign({ id: 'u1' }); // already expired
  assert.equal(tokens.verifyDetailed(shortLived), null);
});

// ---- revocation repo unit --------------------------------------------------
test('revoke + isRevoked + cleanupExpired', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  revokedTokens.revoke('jti-future', future, 'u1');
  revokedTokens.revoke('jti-past', past, 'u1');
  assert.equal(revokedTokens.isRevoked('jti-future'), true);
  assert.equal(revokedTokens.isRevoked('jti-past'), true);
  assert.equal(revokedTokens.isRevoked('never'), false);
  const removed = revokedTokens.cleanupExpired();
  assert.ok(removed >= 1, 'expired entry swept');
  assert.equal(revokedTokens.isRevoked('jti-past'), false, 'expired revocation cleaned up');
  assert.equal(revokedTokens.isRevoked('jti-future'), true, 'live revocation retained');
});

test('revoke is idempotent (same jti twice does not throw)', () => {
  const exp = new Date(Date.now() + 3600_000).toISOString();
  revokedTokens.revoke('dup', exp, 'u1');
  revokedTokens.revoke('dup', exp, 'u1');
  assert.equal(revokedTokens.isRevoked('dup'), true);
});

// ---- end-to-end HTTP flow --------------------------------------------------
test('H1 flow: valid token works; after logout it is rejected; a second token still works', async () => {
  users._add({ id: 'u1', email: 'u1@x.com' });
  const { s, url } = await listen(makeApp());
  try {
    const tokenA = tokens.sign({ id: 'u1' });
    const tokenB = tokens.sign({ id: 'u1' });

    // 1) protected endpoint with a valid token -> success
    let res = await fetch(url + '/api/protected', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(res.status, 200);

    // 2) logout with tokenA -> revokes it
    res = await fetch(url + '/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    // 2b) tokenA now rejected
    res = await fetch(url + '/api/protected', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(res.status, 401, 'revoked token must be rejected');

    // 3) a different, newly-issued token still works
    res = await fetch(url + '/api/protected', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.equal(res.status, 200, 'other sessions are not broken');
  } finally { await new Promise((r) => s.close(r)); }
});

test('missing / invalid tokens are rejected (401)', async () => {
  users._add({ id: 'u1', email: 'u1@x.com' });
  const { s, url } = await listen(makeApp());
  try {
    let res = await fetch(url + '/api/protected');
    assert.equal(res.status, 401, 'missing token');
    res = await fetch(url + '/api/protected', { headers: { Authorization: 'Bearer not.a.jwt' } });
    assert.equal(res.status, 401, 'malformed token');
  } finally { await new Promise((r) => s.close(r)); }
});

test('revocation persists across a repository restart (same DB file)', async () => {
  users._add({ id: 'u1', email: 'u1@x.com' });
  const token = tokens.sign({ id: 'u1' });
  const jti = tokens.verifyDetailed(token).jti;
  const exp = new Date(tokens.verifyDetailed(token).exp * 1000).toISOString();
  revokedTokens.revoke(jti, exp, 'u1');

  // New repository instance over the SAME db handle => persisted.
  const repo2 = new SqliteRevokedTokenRepository(db);
  assert.equal(repo2.isRevoked(jti), true, 'revocation is persisted');
});

test('FAIL CLOSED: if the revocation store throws, the request is rejected (not accepted)', async () => {
  users._add({ id: 'u1', email: 'u1@x.com' });
  const throwingStore = { isRevoked() { throw new Error('store down'); }, revoke() {}, cleanupExpired() { return 0; } };
  const { s, url } = await listen(makeApp({ revokedStore: throwingStore }));
  try {
    const token = tokens.sign({ id: 'u1' });
    const res = await fetch(url + '/api/protected', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 401, 'revocation-store failure must fail closed');
  } finally { await new Promise((r) => s.close(r)); }
});

test('logout without a token still returns ok (idempotent) and clears cookie', async () => {
  const { s, url } = await listen(makeApp());
  try {
    const res = await fetch(url + '/api/auth/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally { await new Promise((r) => s.close(r)); }
});
