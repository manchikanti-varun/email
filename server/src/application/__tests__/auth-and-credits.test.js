// PHASE 2B.11 / 2B.14(part) / 2B.15 / 2B.16 — Auth, API-key, and credit
// integrity, exercising the REAL use cases + REAL security services against a
// temporary SQLite database. No production data is touched.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { SqliteUserRepository } from '../../infrastructure/persistence/sqlite/user-repository.js';
import { BcryptPasswordHasher } from '../../infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from '../../infrastructure/security/jwt-token-service.js';
import { Sha256ApiKeyService } from '../../infrastructure/security/api-key-service.js';
import { RegisterUser, LoginUser, RotateApiKey } from '../auth-use-cases.js';
import { VerifySingleEmail } from '../verify-use-cases.js';
import { AppError } from '../errors.js';

let dbPath, db, users, hasher, tokens, apiKeys;
const JWT_SECRET = 'test-secret-that-is-long-enough-to-be-valid-1234567890';

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-auth-${Date.now()}.db`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      name TEXT, credits INTEGER NOT NULL DEFAULT 1000, plan TEXT NOT NULL DEFAULT 'free',
      api_key_hash TEXT, api_key_prefix TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  users = new SqliteUserRepository(db);
  hasher = new BcryptPasswordHasher(6); // fewer rounds = faster tests
  tokens = new JwtTokenService(JWT_SECRET);
  apiKeys = new Sha256ApiKeyService();
});

after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});

beforeEach(() => { db.exec('DELETE FROM users'); });

function register(email = 'a@example.com', password = 'password1', credits = 1000) {
  const uc = new RegisterUser({ users, passwordHasher: hasher, tokenService: tokens, apiKeyService: apiKeys, signupCredits: credits });
  return uc.execute({ email, password });
}

// ---- Registration ----------------------------------------------------------
test('register: creates user, returns token + plaintext apiKey once', () => {
  const r = register();
  assert.ok(r.token, 'token issued');
  assert.ok(r.apiKey && r.apiKey.startsWith('elh_'), 'plaintext api key returned');
  assert.equal(r.user.credits, 1000);
  // Stored value must be a hash, never the plaintext key or password.
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('a@example.com');
  assert.notEqual(row.api_key_hash, r.apiKey);
  assert.equal(row.api_key_hash, apiKeys.hash(r.apiKey));
  assert.ok(row.password_hash.startsWith('$2'), 'password stored as bcrypt hash');
  assert.equal(row.api_key_prefix, r.apiKey.slice(0, 12));
});

test('register: duplicate email -> 409', () => {
  register('dup@example.com');
  assert.throws(() => register('dup@example.com'), (e) => e instanceof AppError && e.status === 409);
});

test('register: weak password rejected (400)', () => {
  assert.throws(() => register('w@example.com', 'short'), (e) => e.status === 400);
  assert.throws(() => register('w@example.com', 'alphabetsonly'), (e) => e.status === 400);
});

test('register: invalid email rejected (400)', () => {
  assert.throws(() => register('not-an-email', 'password1'), (e) => e.status === 400);
});

// ---- Login -----------------------------------------------------------------
test('login: success returns token; wrong password -> 401', () => {
  register('login@example.com', 'password1');
  const login = new LoginUser({ users, passwordHasher: hasher, tokenService: tokens });
  const ok = login.execute({ email: 'login@example.com', password: 'password1' });
  assert.ok(ok.token);
  assert.throws(() => login.execute({ email: 'login@example.com', password: 'wrong1234' }), (e) => e.status === 401);
  // Unknown user -> also 401 (no enumeration).
  assert.throws(() => login.execute({ email: 'nobody@example.com', password: 'password1' }), (e) => e.status === 401);
});

// ---- JWT / documented logout (H1) -----------------------------------------
test('JWT: sign then verify yields the user id', () => {
  const r = register('jwt@example.com');
  const id = tokens.verify(r.token);
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get('jwt@example.com');
  assert.equal(id, row.id);
});

test('invalid JWT -> verify returns null', () => {
  assert.equal(tokens.verify('garbage.token.here'), null);
  assert.equal(tokens.verify(''), null);
});

test('H1 (documented): a JWT stays valid after logout — no server-side revocation', () => {
  // Logout only clears the cookie; the stateless token remains verifiable.
  // This test PINS the documented finding (does NOT fix it).
  const r = register('h1@example.com');
  const before = tokens.verify(r.token);
  assert.ok(before, 'token valid before logout');
  // There is no revocation call; simulate "after logout" by re-verifying.
  const after = tokens.verify(r.token);
  assert.ok(after, 'token STILL valid after logout (documented H1)');
  assert.equal(before, after);
});

// ---- API key rotation ------------------------------------------------------
test('rotate: old key invalid, new key valid, wrong key rejected', () => {
  const reg = register('rot@example.com');
  const oldHash = apiKeys.hash(reg.apiKey);
  assert.ok(users.findByApiKeyHash(oldHash), 'old key resolves before rotation');

  const rot = new RotateApiKey({ users, apiKeyService: apiKeys });
  const out = rot.execute(reg.user.id);
  assert.ok(out.apiKey.startsWith('elh_'));
  assert.notEqual(out.apiKey, reg.apiKey);

  assert.equal(users.findByApiKeyHash(oldHash), null, 'old key no longer valid');
  assert.ok(users.findByApiKeyHash(apiKeys.hash(out.apiKey)), 'new key valid');
  assert.equal(users.findByApiKeyHash(apiKeys.hash('elh_wrongkey')), null, 'wrong key rejected');
});

// ---- Credit integrity ------------------------------------------------------
test('single verify: 100 credits -> 99 after one verify', async () => {
  const reg = register('c1@example.com', 'password1', 100);
  const engine = { verify: async () => ({ email: 'x', deliverability: 'unknown', mailboxStatus: 'UNKNOWN' }) };
  const uc = new VerifySingleEmail({ users, verificationEngine: engine });
  const out = await uc.execute(reg.user.id, 'x@example.com');
  assert.equal(out.credits, 99);
});

test('insufficient credits: 0 balance -> 402, balance stays 0, engine NOT called', async () => {
  const reg = register('c0@example.com', 'password1', 0);
  let called = false;
  const engine = { verify: async () => { called = true; return {}; } };
  const uc = new VerifySingleEmail({ users, verificationEngine: engine });
  await assert.rejects(() => uc.execute(reg.user.id, 'x@example.com'), (e) => e.status === 402);
  assert.equal(called, false, 'engine must not run when unaffordable');
  assert.equal(users.findById(reg.user.id).credits, 0);
});

test('empty input -> 400, no credit consumed', async () => {
  const reg = register('c2@example.com', 'password1', 5);
  const engine = { verify: async () => ({}) };
  const uc = new VerifySingleEmail({ users, verificationEngine: engine });
  await assert.rejects(() => uc.execute(reg.user.id, ''), (e) => e.status === 400);
  assert.equal(users.findById(reg.user.id).credits, 5, 'no charge on empty input');
});

test('oversized input (>254) -> 400, no credit consumed', async () => {
  const reg = register('c3@example.com', 'password1', 5);
  const engine = { verify: async () => ({}) };
  const uc = new VerifySingleEmail({ users, verificationEngine: engine });
  const huge = 'a'.repeat(250) + '@example.com';
  await assert.rejects(() => uc.execute(reg.user.id, huge), (e) => e.status === 400);
  assert.equal(users.findById(reg.user.id).credits, 5, 'no charge on oversized input');
});

test('UNKNOWN verdict still consumes a credit (documented; no refund)', async () => {
  const reg = register('c4@example.com', 'password1', 3);
  const engine = { verify: async () => ({ email: 'x', deliverability: 'unknown', mailboxStatus: 'UNKNOWN' }) };
  const uc = new VerifySingleEmail({ users, verificationEngine: engine });
  await uc.execute(reg.user.id, 'x@example.com');
  assert.equal(users.findById(reg.user.id).credits, 2, 'credit consumed even for UNKNOWN');
});

test('concurrent charging never oversells and never goes negative', async () => {
  const reg = register('cc@example.com', 'password1', 10);
  const id = reg.user.id;
  // 50 concurrent single-credit charges against a balance of 10.
  const results = await Promise.all(
    Array.from({ length: 50 }, () => Promise.resolve().then(() => users.chargeCredits(id, 1))),
  );
  const successes = results.filter(Boolean).length;
  const balance = users.findById(id).credits;
  assert.equal(successes, 10, 'exactly 10 charges succeed');
  assert.equal(balance, 0, 'balance lands exactly at 0');
  assert.ok(balance >= 0, 'balance never negative');
});

test('chargeCredits: cannot overdraw in a single large charge', () => {
  const reg = register('cd@example.com', 'password1', 5);
  assert.equal(users.chargeCredits(reg.user.id, 6), false, 'over-charge refused');
  assert.equal(users.findById(reg.user.id).credits, 5, 'balance unchanged on refusal');
  assert.equal(users.chargeCredits(reg.user.id, 5), true, 'exact charge allowed');
  assert.equal(users.findById(reg.user.id).credits, 0);
});
