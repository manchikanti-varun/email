import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteContactRepository } from '../contact-repository.js';

let dbPath;
let db;
let contacts;

before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-insert-${Date.now()}.db`);
  db = new Database(dbPath);
  // Minimal schema + columns referenced by SqliteContactRepository's prepared UPDATE.
  db.exec(`
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      email TEXT NOT NULL,
      score INTEGER,
      classification TEXT,
      status TEXT,
      signals TEXT,
      reasons TEXT,
      recommendation TEXT,
      greylisted INTEGER DEFAULT 0,
      provider TEXT,
      retry_after TEXT,
      deliverability TEXT,
      confidence TEXT,
      recommended_action TEXT,
      risk_signals TEXT,
      calibrated_confidence REAL,
      calibration_level TEXT,
      calibration_model TEXT,
      mailbox_status TEXT,
      verification_quality TEXT,
      smtp_evidence TEXT,
      acceptance_type TEXT,
      verified_at TEXT
    );
  `);
  contacts = new SqliteContactRepository(db);
});

after(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});

test('insertMany writes all emails and supports large batches', () => {
  const n = 1200;
  const emails = Array.from({ length: n }, (_, i) => `user${i}@example.com`);
  contacts.insertMany('list-1', emails);
  const count = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE list_id = ?').get('list-1').n;
  assert.equal(count, n);
  const sample = db.prepare('SELECT email FROM contacts WHERE list_id = ? LIMIT 1').get('list-1');
  assert.match(sample.email, /@example\.com$/);
});

test('insertMany no-ops on empty array', () => {
  contacts.insertMany('list-empty', []);
  const count = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE list_id = ?').get('list-empty').n;
  assert.equal(count, 0);
});
