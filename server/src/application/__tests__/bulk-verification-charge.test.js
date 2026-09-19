// PHASE 2C.4 — StartListVerification credit-charge semantics (use-case level,
// real repositories + temp SQLite). Confirms charge-before-work, no charge on
// failure paths, and preserved duplicate/already-running behavior. Does NOT
// change the charge-before-work business rule.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { SqliteUserRepository } from '../../infrastructure/persistence/sqlite/user-repository.js';
import { SqliteListRepository } from '../../infrastructure/persistence/sqlite/list-repository.js';
import { SqliteContactRepository } from '../../infrastructure/persistence/sqlite/contact-repository.js';
import { StartListVerification } from '../list-use-cases.js';
import { AppError } from '../errors.js';

let dbPath, db, users, lists, contacts;

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-bulk-${Date.now()}.db`);
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      name TEXT, credits INTEGER NOT NULL DEFAULT 1000, plan TEXT NOT NULL DEFAULT 'free',
      api_key_hash TEXT, api_key_prefix TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE lists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, source TEXT,
      total INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE contacts (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, email TEXT NOT NULL,
      score INTEGER, classification TEXT, status TEXT, signals TEXT, reasons TEXT, recommendation TEXT,
      greylisted INTEGER DEFAULT 0, provider TEXT, retry_after TEXT, deliverability TEXT, confidence TEXT,
      recommended_action TEXT, risk_signals TEXT, calibrated_confidence REAL, calibration_level TEXT,
      calibration_model TEXT, mailbox_status TEXT, verification_quality TEXT, smtp_evidence TEXT,
      acceptance_type TEXT, verified_at TEXT);
  `);
  users = new SqliteUserRepository(db);
  lists = new SqliteListRepository(db);
  contacts = new SqliteContactRepository(db);
});
after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});
beforeEach(() => { db.exec('DELETE FROM contacts; DELETE FROM lists; DELETE FROM users;'); });

function seed({ credits = 1000, contactsN = 5, status = 'pending' } = {}) {
  users.create({ id: 'u1', email: 'u1@x.com', password_hash: 'h', name: 'u', credits, plan: 'free', api_key_hash: null, api_key_prefix: null });
  lists.create({ id: 'l1', userId: 'u1', name: 'L', source: null, total: contactsN, duplicates: 0, status });
  contacts.insertMany('l1', Array.from({ length: contactsN }, (_, i) => `c${i}@x.com`));
}

// A queue spy that records enqueue calls without doing work.
function spyQueue() {
  const calls = [];
  return { calls, enqueue: (userId, listId, type) => { calls.push({ userId, listId, type }); return 'job-1'; } };
}

test('sufficient credits -> starts, charges exactly pending count, enqueues one job', () => {
  seed({ credits: 10, contactsN: 5 });
  const queue = spyQueue();
  const uc = new StartListVerification({ lists, contacts, users, queue });
  const out = uc.execute('u1', 'l1', false);
  assert.equal(out.started, true);
  assert.equal(out.total, 5);
  assert.equal(users.findById('u1').credits, 5, 'charged 5 (pending count)');
  assert.equal(queue.calls.length, 1, 'exactly one job enqueued');
  assert.equal(queue.calls[0].type, 'verify');
});

test('insufficient credits -> 402 with needed, NO charge, NO job', () => {
  seed({ credits: 3, contactsN: 5 });
  const queue = spyQueue();
  const uc = new StartListVerification({ lists, contacts, users, queue });
  assert.throws(() => uc.execute('u1', 'l1', false), (e) => e instanceof AppError && e.status === 402 && e.needed === 5);
  assert.equal(users.findById('u1').credits, 3, 'credits unchanged');
  assert.equal(queue.calls.length, 0, 'no job started');
});

test('invalid list -> 404, NO charge', () => {
  seed({ credits: 100, contactsN: 5 });
  const queue = spyQueue();
  const uc = new StartListVerification({ lists, contacts, users, queue });
  assert.throws(() => uc.execute('u1', 'does-not-exist', false), (e) => e.status === 404);
  assert.equal(users.findById('u1').credits, 100, 'no charge for a missing list');
  assert.equal(queue.calls.length, 0);
});

test('already-verifying list -> 409, NO charge, NO new job (preserved semantics)', () => {
  seed({ credits: 100, contactsN: 5, status: 'verifying' });
  const queue = spyQueue();
  const uc = new StartListVerification({ lists, contacts, users, queue });
  assert.throws(() => uc.execute('u1', 'l1', false), (e) => e.status === 409);
  assert.equal(users.findById('u1').credits, 100, 'no double charge for a running verification');
  assert.equal(queue.calls.length, 0);
});

test('nothing to verify (all already verified) -> 400, NO charge', () => {
  seed({ credits: 100, contactsN: 3 });
  db.prepare("UPDATE contacts SET verified_at = datetime('now') WHERE list_id = 'l1'").run();
  const queue = spyQueue();
  const uc = new StartListVerification({ lists, contacts, users, queue });
  assert.throws(() => uc.execute('u1', 'l1', false), (e) => e.status === 400);
  assert.equal(users.findById('u1').credits, 100);
  assert.equal(queue.calls.length, 0);
});

test('charge happens BEFORE enqueue (order): a failed charge never reaches the queue', () => {
  seed({ credits: 2, contactsN: 5 });
  // Queue that would throw if called — proves we never enqueue on an unaffordable charge.
  const uc = new StartListVerification({
    lists, contacts, users,
    queue: { enqueue: () => { throw new Error('queue must not be called when charge fails'); } },
  });
  assert.throws(() => uc.execute('u1', 'l1', false), (e) => e.status === 402);
});
