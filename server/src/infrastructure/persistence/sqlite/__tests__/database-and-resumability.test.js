// PHASE 2B.13 / 2B.20 — Database integrity (schema, FK cascade, WAL, result +
// job + history persistence) and queue resumability, using REAL repositories +
// the REAL VerificationQueue against a TEMPORARY SQLite database. Production
// data/app.db is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { SqliteUserRepository } from '../user-repository.js';
import { SqliteListRepository } from '../list-repository.js';
import { SqliteContactRepository } from '../contact-repository.js';
import { SqliteHistoryRepository } from '../history-repository.js';
import { SqliteJobRepository } from '../job-repository.js';
import { SqliteAlertRepository } from '../alert-repository.js';
import { VerificationQueue } from '../../../jobs/verification-queue.js';
import { summarize } from '../../../../domain/verification/health.js';

// Full schema subset mirroring connection.js (FK ON, WAL).
function makeDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      name TEXT, credits INTEGER NOT NULL DEFAULT 1000, plan TEXT NOT NULL DEFAULT 'free',
      api_key_hash TEXT, api_key_prefix TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE lists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, source TEXT, total INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE contacts (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      email TEXT NOT NULL, score INTEGER, classification TEXT, status TEXT, signals TEXT, reasons TEXT,
      recommendation TEXT, greylisted INTEGER DEFAULT 0, provider TEXT, retry_after TEXT,
      deliverability TEXT, confidence TEXT, recommended_action TEXT, risk_signals TEXT,
      calibrated_confidence REAL, calibration_level TEXT, calibration_model TEXT,
      mailbox_status TEXT, verification_quality TEXT, smtp_evidence TEXT, acceptance_type TEXT, verified_at TEXT);
    CREATE TABLE list_history (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      health REAL NOT NULL, metrics TEXT NOT NULL, counts TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, type TEXT NOT NULL DEFAULT 'verify',
      status TEXT NOT NULL DEFAULT 'queued', total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, level TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL, body TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  return db;
}

let dbPath, db, users, lists, contacts, history, jobs, alerts;

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-db-${Date.now()}.db`);
  db = makeDb(dbPath);
  users = new SqliteUserRepository(db);
  lists = new SqliteListRepository(db);
  contacts = new SqliteContactRepository(db);
  history = new SqliteHistoryRepository(db);
  jobs = new SqliteJobRepository(db);
  alerts = new SqliteAlertRepository(db);
});
after(() => {
  try { db.close(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ } }
});

test('WAL journal mode and foreign_keys are enabled', () => {
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('FK cascade: deleting a list removes its contacts + history + jobs', () => {
  users.create({ id: 'u1', email: 'u1@x.com', password_hash: 'h', name: 'u', credits: 100, plan: 'free', api_key_hash: null, api_key_prefix: null });
  lists.create({ id: 'l1', userId: 'u1', name: 'L', source: null, total: 2, duplicates: 0, status: 'pending' });
  contacts.insertMany('l1', ['a@x.com', 'b@x.com']);
  jobs.create({ userId: 'u1', listId: 'l1', type: 'verify' });
  history.add('l1', { health: 50, metrics: {}, counts: {} });

  assert.equal(contacts.countByList('l1'), 2);
  lists.deleteForUser('l1', 'u1');
  assert.equal(contacts.countByList('l1'), 0, 'contacts cascade-deleted');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM list_history WHERE list_id=?').get('l1').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs WHERE list_id=?').get('l1').n, 0);
});

test('result persistence round-trips verdict + additive fields', () => {
  users.create({ id: 'u2', email: 'u2@x.com', password_hash: 'h', name: 'u', credits: 100, plan: 'free', api_key_hash: null, api_key_prefix: null });
  lists.create({ id: 'l2', userId: 'u2', name: 'L', source: null, total: 1, duplicates: 0, status: 'pending' });
  contacts.insertMany('l2', ['keep@x.com']);
  const [row] = contacts.findByList('l2');
  contacts.saveResult(row.id, {
    email: 'keep@x.com', score: 100, classification: 'safe', status: 'accepted',
    signals: [], reasons: ['ok'], recommendation: 'KEEP', greylisted: false, provider: null,
    deliverability: 'accepted', confidence: 'medium', recommendedAction: 'keep', riskSignals: [{ code: 'catch_all' }],
    mailboxStatus: 'ACCEPT_ALL', verificationQuality: 'MEDIUM', smtpEvidence: { finalReason: 'catch_all_domain' },
    acceptanceType: 'CATCH_ALL', verified_at: new Date().toISOString(),
  });
  const [saved] = contacts.findByList('l2');
  assert.equal(saved.classification, 'safe');
  assert.equal(saved.mailboxStatus, 'ACCEPT_ALL');
  assert.equal(saved.acceptanceType, 'CATCH_ALL');
  assert.equal(saved.smtpEvidence.finalReason, 'catch_all_domain');
  assert.ok(saved.verified_at, 'verified_at persisted');
});

test('greylisted result sets retry_after ~30 minutes in the future', () => {
  users.create({ id: 'u3', email: 'u3@x.com', password_hash: 'h', name: 'u', credits: 100, plan: 'free', api_key_hash: null, api_key_prefix: null });
  lists.create({ id: 'l3', userId: 'u3', name: 'L', source: null, total: 1, duplicates: 0, status: 'pending' });
  contacts.insertMany('l3', ['grey@x.com']);
  const [row] = contacts.findByList('l3');
  contacts.saveResult(row.id, {
    email: 'grey@x.com', score: 80, classification: 'unknown', status: 'unknown',
    signals: [], reasons: [], recommendation: '', greylisted: true, provider: null,
    deliverability: 'unknown', confidence: 'low', recommendedAction: 'reverify', riskSignals: [],
    verified_at: new Date().toISOString(),
  });
  const raw = db.prepare('SELECT retry_after FROM contacts WHERE id=?').get(row.id);
  assert.ok(raw.retry_after, 'retry_after set for greylisted');
  const deltaMin = (new Date(raw.retry_after).getTime() - Date.now()) / 60000;
  assert.ok(deltaMin > 25 && deltaMin < 35, `retry_after ~30min, got ${deltaMin.toFixed(1)}min`);
});

// ---- 2B.13 Queue resumability ---------------------------------------------
test('queue resumes an interrupted job: remaining processed once, finalized once', async () => {
  users.create({ id: 'u4', email: 'u4@x.com', password_hash: 'h', name: 'u', credits: 1000, plan: 'free', api_key_hash: null, api_key_prefix: null });
  lists.create({ id: 'l4', userId: 'u4', name: 'L', source: null, total: 6, duplicates: 0, status: 'pending' });
  contacts.insertMany('l4', ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com']);

  const verifiedEmails = [];
  let finalizeCount = 0;
  const engine = {
    preResolveDomains: async () => {},
    verify: async (email) => {
      verifiedEmails.push(email);
      return {
        email, score: 100, classification: 'safe', status: 'deliverable', signals: [], reasons: [],
        recommendation: 'KEEP', greylisted: false, provider: null, deliverability: 'deliverable',
        confidence: 'high', recommendedAction: 'keep', riskSignals: [], mailboxStatus: 'DELIVERABLE',
        verificationQuality: 'HIGH', verified_at: new Date().toISOString(),
      };
    },
  };
  const historySpy = { add: (id, s) => { finalizeCount++; history.add(id, s); }, latest: (id, n) => history.latest(id, n) };

  const makeQueue = () => new VerificationQueue({
    jobRepository: jobs, listRepository: lists, contactRepository: contacts,
    historyRepository: historySpy, alertRepository: alerts, verificationEngine: engine,
    webhookSender: { fire() {} }, summarize, concurrency: 2,
  });

  // Step 1: create job.
  const { id: jobId } = jobs.create({ userId: 'u4', listId: 'l4', type: 'verify' });

  // Step 2: simulate partial completion — verify 2 contacts + persist progress,
  // then "interrupt" (do not finalize).
  const pending = contacts.findPending('l4', 'verify');
  for (let i = 0; i < 2; i++) {
    const r = await engine.verify(pending[i].email);
    contacts.saveResult(pending[i].id, r);
  }
  jobs.markRunning(jobId);
  jobs.updateProgress(jobId, 2);
  verifiedEmails.length = 0; // reset — count only work done AFTER resume.

  // Step 3–5: restart queue and process the SAME job row (still queued/running).
  const job = jobs.nextRunnable();
  assert.equal(job.id, jobId, 'the interrupted job is the next runnable');
  await makeQueue()._runJob(job);

  // Step 6: already-verified contacts are NOT reprocessed (findPending filters verified_at).
  assert.equal(verifiedEmails.length, 4, 'only the 4 remaining contacts are processed on resume');

  // Step 7: finalized exactly once for this resume.
  assert.equal(finalizeCount, 1, 'finalization occurs once');

  // Step 8: progress correct + all 6 contacts verified + job done.
  const allVerified = db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id=? AND verified_at IS NOT NULL').get('l4').n;
  assert.equal(allVerified, 6, 'all contacts end verified');
  const jobRow = db.prepare('SELECT status, done FROM jobs WHERE id=?').get(jobId);
  assert.equal(jobRow.status, 'done');
  assert.equal(jobRow.done, 6);
  assert.equal(lists.findById('l4').status, 'done');
});
