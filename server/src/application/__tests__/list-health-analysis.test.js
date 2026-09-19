// Tests for AnalyzeListHealth / GetLatestListAnalysis use cases.
// Verifies: deterministic report is always produced; AI is fail-safe (valid /
// malformed / timeout / unavailable all yield a usable analysis); persistence;
// ownership; AI cannot override the deterministic verdict/metrics; and no
// secrets reach the AI.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { SqliteListAnalysisRepository } from '../../infrastructure/persistence/sqlite/list-analysis-repository.js';
import { AnalyzeListHealth, GetLatestListAnalysis } from '../list-health-use-cases.js';
import { AppError } from '../errors.js';

// ---- Fakes -----------------------------------------------------------------
function contact(email, deliverability, over = {}) {
  return {
    email, deliverability, status: deliverability,
    classification: over.classification || ({ deliverable: 'safe', accepted: 'safe', undeliverable: 'remove', unknown: 'unknown' }[deliverability] || 'unknown'),
    riskSignals: over.riskSignals || [], signals: [], verified_at: new Date().toISOString(),
  };
}
const OWNER = 'user-1';
const LIST = 'list-1';
function detailFor(contacts) {
  return {
    list: { id: LIST, name: 'My List', total: contacts.length, status: 'done' },
    summary: { health: 80, metrics: {} },
    contacts, history: [],
  };
}
// getListDetail fake that enforces ownership (throws 404 for other users/lists).
function fakeGetListDetail(contacts) {
  return {
    execute(userId, listId) {
      if (userId !== OWNER || listId !== LIST) throw new AppError(404, 'List not found');
      return detailFor(contacts);
    },
  };
}
// AiProvider fakes.
function aiValid(capture) {
  return {
    isEnabled: () => true, hasModel: () => true,
    completeJson: async ({ system, messages }) => {
      if (capture) capture.push({ system, messages });
      return {
        ok: true, model: 'fake-model', latencyMs: 12, estimatedCost: 0.0001,
        json: {
          summary: 'AI says the list is mostly healthy.',
          keyIssues: [{ issue: 'Undeliverables', severity: 'high', evidence: 'some', impact: 'reputation' }],
          recommendations: [{ action: 'Remove undeliverables', priority: 'high', reason: 'bounces' }],
          observations: ['gmail heavy'],
        },
      };
    },
  };
}
const aiMalformed = { isEnabled: () => true, hasModel: () => true, completeJson: async () => ({ ok: false, json: null, error: 'unparseable_json', latencyMs: 5, model: 'fake' }) };
const aiTimeout = { isEnabled: () => true, hasModel: () => true, completeJson: async () => { throw new Error('worker-timeout'); } };
const aiOverride = {
  isEnabled: () => true, hasModel: () => true,
  completeJson: async () => ({
    ok: true, model: 'evil', latencyMs: 1,
    // The model tries to smuggle a verdict override — must be ignored.
    json: { summary: 'All good', keyIssues: [], recommendations: [], observations: [], healthScore: 100, metrics: { undeliverable: 0 }, classification: 'safe' },
  }),
};
const aiUnavailable = { isEnabled: () => true, hasModel: () => false, completeJson: async () => { throw new Error('should not be called'); } };

let dbPath, db, repo;
before(() => {
  dbPath = path.join(os.tmpdir(), `mailhealth-lha-${Date.now()}.db`);
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE lists (id TEXT PRIMARY KEY);
    CREATE TABLE list_analysis (
      list_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, health_score REAL NOT NULL, health_level TEXT NOT NULL,
      metrics TEXT NOT NULL, diagnosis TEXT, diagnosis_source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.prepare('INSERT INTO users (id) VALUES (?)').run(OWNER);
  db.prepare('INSERT INTO lists (id) VALUES (?)').run(LIST);
  repo = new SqliteListAnalysisRepository(db);
});
after(() => { try { db.close(); } catch { /* ignore */ } try { fs.unlinkSync(dbPath); } catch { /* ignore */ } });
beforeEach(() => { db.exec('DELETE FROM list_analysis'); });

const mixed = [
  ...Array.from({ length: 8 }, (_, i) => contact(`d${i}@gmail.com`, 'deliverable')),
  contact('x@dead.example', 'undeliverable'),
  contact('u@slow.example', 'unknown'),
];

// ---- AI valid --------------------------------------------------------------
test('AI valid: returns AI diagnosis + deterministic report; source=ai; persists', async () => {
  const capture = [];
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiValid(capture), analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST);
  assert.equal(out.diagnosisMeta.source, 'ai');
  assert.equal(out.diagnosis.summary, 'AI says the list is mostly healthy.');
  // Deterministic report is present and authoritative.
  assert.equal(out.metrics.total, 10);
  assert.equal(out.metrics.undeliverable, 1);
  assert.ok(out.healthScore > 0 && out.healthScore <= 100);
  // Persisted.
  const latest = repo.findLatest(OWNER, LIST);
  assert.ok(latest);
  assert.equal(latest.diagnosisSource, 'ai');
  assert.equal(latest.healthScore, out.healthScore);
  // Exactly one LLM call.
  assert.equal(capture.length, 1);
});

// ---- AI malformed ----------------------------------------------------------
test('AI malformed JSON: falls back to deterministic diagnosis (analysis still succeeds)', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiMalformed, analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST);
  assert.equal(out.diagnosisMeta.source, 'deterministic');
  assert.equal(out.diagnosisMeta.error, 'unparseable_json');
  assert.ok(out.diagnosis.summary.length > 0);
  assert.equal(out.metrics.undeliverable, 1);
});

// ---- AI timeout / throw ----------------------------------------------------
test('AI timeout/throw: never fails the analysis; deterministic fallback used', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiTimeout, analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST);
  assert.equal(out.diagnosisMeta.source, 'deterministic');
  assert.equal(out.diagnosisMeta.error, 'worker-timeout');
  assert.ok(out.healthScore >= 0);
});

// ---- AI unavailable (no model) ---------------------------------------------
test('AI unavailable (no model): deterministic path, provider never called', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiUnavailable, analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST);
  assert.equal(out.diagnosisMeta.source, 'deterministic');
  assert.ok(out.diagnosis.summary.length > 0);
});

// ---- useAi:false forces deterministic --------------------------------------
test('useAi=false forces the deterministic path even when AI is available', async () => {
  const capture = [];
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiValid(capture), analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST, { useAi: false });
  assert.equal(out.diagnosisMeta.source, 'deterministic');
  assert.equal(capture.length, 0, 'no LLM call when useAi=false');
});

// ---- AI cannot override deterministic verdict/metrics ----------------------
test('AI cannot override the deterministic score/metrics (only diagnosis text is taken)', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiOverride, analysisRepository: repo });
  const out = await uc.execute(OWNER, LIST);
  // The evil model claimed healthScore:100 / undeliverable:0 — must be ignored.
  assert.notEqual(out.healthScore, 100, 'deterministic score wins');
  assert.equal(out.metrics.undeliverable, 1, 'deterministic metrics win');
  // Only the validated text fields are accepted from the model.
  assert.equal('healthScore' in out.diagnosis, false);
  assert.equal('metrics' in out.diagnosis, false);
  assert.equal('classification' in out.diagnosis, false);
});

// ---- No secrets reach the AI -----------------------------------------------
test('the AI input contains no secrets and no full email addresses', async () => {
  const capture = [];
  const contacts = [contact('john.doe.private@gmail.com', 'deliverable'), contact('x@dead.example', 'undeliverable')];
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(contacts), aiProvider: aiValid(capture), analysisRepository: repo });
  await uc.execute(OWNER, LIST);
  const sent = JSON.stringify(capture[0]).toLowerCase();
  for (const forbidden of ['secret', 'api_key', 'apikey', 'password', 'token', 'authorization', 'bearer', 'jwt', 'encryption', 'john.doe.private']) {
    assert.ok(!sent.includes(forbidden), `AI payload must not contain "${forbidden}"`);
  }
});

// ---- Ownership -------------------------------------------------------------
test('ownership: another user cannot analyze the list (404)', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiUnavailable, analysisRepository: repo });
  await assert.rejects(() => uc.execute('other-user', LIST), (e) => e.status === 404);
});

test('invalid listId -> 400', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiUnavailable, analysisRepository: repo });
  await assert.rejects(() => uc.execute(OWNER, ''), (e) => e.status === 400);
});

// ---- GetLatestListAnalysis -------------------------------------------------
test('GetLatestListAnalysis: not-analyzed then analyzed', async () => {
  const analyze = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiUnavailable, analysisRepository: repo });
  const get = new GetLatestListAnalysis({ getListDetail: fakeGetListDetail(mixed), analysisRepository: repo });

  const before = get.execute(OWNER, LIST);
  assert.equal(before.available, false);

  await analyze.execute(OWNER, LIST);
  const after = get.execute(OWNER, LIST);
  assert.equal(after.available, true);
  assert.equal(after.healthLevel, (await analyze.execute(OWNER, LIST)).healthLevel);
  // Another user cannot read it.
  assert.throws(() => get.execute('other-user', LIST), (e) => e.status === 404);
});

// ---- Works without a repository (persistence optional) ---------------------
test('analysis works with no analysisRepository (persistence is optional)', async () => {
  const uc = new AnalyzeListHealth({ getListDetail: fakeGetListDetail(mixed), aiProvider: aiUnavailable });
  const out = await uc.execute(OWNER, LIST);
  assert.ok(out.healthScore >= 0);
  assert.equal(out.diagnosisMeta.source, 'deterministic');
});
