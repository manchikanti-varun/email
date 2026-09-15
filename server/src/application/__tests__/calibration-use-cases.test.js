// Integration tests for the ML Confidence Calibration APPLICATION layer:
//   Verification result → ML Calibration → use-case output (the API shape).
// Uses fakes that mirror the real return shapes (like ai-use-cases.test.js).
// Confirms the deterministic verdict is passed through UNCHANGED and that the
// system stays safe (fallback) when the model is unavailable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CalibrateVerificationConfidence, CalibrateSingleResult,
  GetCalibrationBenchmark, GetCalibrationDrift,
} from '../ai-use-cases.js';
import { VerifySingleEmail } from '../verify-use-cases.js';
import { ConfidenceCalibrator, trainModel, buildDataset, splitDataset } from '../../../agent/intelligence/calibration/index.js';
import { labelledDataset, result, catchAllResult } from '../../../agent/intelligence/calibration/__tests__/fixtures.js';

const OWNER = 'U1';
const LIST = { id: 'L1', name: 'Customers', total: 3, status: 'done' };

function contacts() {
  return [result({ email: 'a@good.com' }), catchAllResult({ email: 'sales@corp.com' })];
}

function fakeGetListDetail(rows = contacts()) {
  return {
    execute: (userId, listId) => {
      if (userId !== OWNER || listId !== LIST.id) { const e = new Error('not found'); e.status = 404; throw e; }
      return { list: { ...LIST }, summary: {}, contacts: rows, history: [], delta: null };
    },
  };
}

function trainedCalibrator() {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  return new ConfidenceCalibrator({ model: trainModel(train) });
}

// --------------------------------------------------------------------------
test('CalibrateVerificationConfidence: returns verdict + additive confidence, verdict unchanged', () => {
  const uc = new CalibrateVerificationConfidence({ getListDetail: fakeGetListDetail(), calibrator: trainedCalibrator() });
  const out = uc.execute(OWNER, 'L1', { email: 'a@good.com' });
  assert.equal(out.verdict, 'deliverable');       // deterministic verdict passed through
  assert.ok(out.confidence);                        // additive ML block present
  assert.equal(out.confidence.available, true);
  assert.ok(out.confidence.score >= 0 && out.confidence.score <= 1);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(out.confidence.level));
});

test('CalibrateVerificationConfidence: enforces ownership (404) and missing contact (404)', () => {
  const uc = new CalibrateVerificationConfidence({ getListDetail: fakeGetListDetail(), calibrator: trainedCalibrator() });
  assert.throws(() => uc.execute('intruder', 'L1', { email: 'a@good.com' }), (e) => e.status === 404);
  assert.throws(() => uc.execute(OWNER, 'L1', { email: 'nobody@nowhere.com' }), (e) => e.status === 404);
});

test('CalibrateVerificationConfidence: FALLBACK when calibrator has no model (never fails)', () => {
  const uc = new CalibrateVerificationConfidence({ getListDetail: fakeGetListDetail(), calibrator: new ConfidenceCalibrator({ model: null }) });
  const out = uc.execute(OWNER, 'L1', { email: 'a@good.com' });
  assert.equal(out.verdict, 'deliverable');
  assert.equal(out.confidence.available, false);
  assert.equal(out.confidence.source, 'rule-engine');
});

test('CalibrateSingleResult: calibrates an ad-hoc result; rejects bad input', () => {
  const uc = new CalibrateSingleResult({ calibrator: trainedCalibrator() });
  const out = uc.execute(OWNER, result());
  assert.ok(out.available === true);
  assert.throws(() => uc.execute(OWNER, null), (e) => e.status === 400);
});

test('GetCalibrationBenchmark: INSUFFICIENT DATA is reported honestly (no fabrication)', () => {
  const uc = new GetCalibrationBenchmark();
  const out = uc.execute(OWNER, { dataset: [] });
  assert.equal(out.available, false);
  assert.match(out.message, /Insufficient validated benchmark samples|UNAVAILABLE/i);
});

test('GetCalibrationBenchmark: trains a candidate and compares rule vs rule+ML (evaluation only)', () => {
  const uc = new GetCalibrationBenchmark();
  const out = uc.execute(OWNER, { dataset: labelledDataset(180) });
  assert.equal(out.available, true);
  assert.ok(out.metrics && out.metrics.available);
  assert.ok(out.comparison && out.comparison.verdict);
  assert.ok('recommendDeploy' in out.comparison.verdict);
  assert.match(out.note, /does not deploy|no verdict|never/i);
});

test('GetCalibrationDrift: advisory report', () => {
  const uc = new GetCalibrationDrift();
  const out = uc.execute(OWNER, {
    baseline: { brierScore: 0.1, accuracy: 90, falsePositiveRate: 5, falseNegativeRate: 5 },
    recent: { brierScore: 0.25, accuracy: 78, falsePositiveRate: 15, falseNegativeRate: 6 },
  });
  assert.equal(out.drift, true);
  assert.equal(out.status, 'MODEL DRIFT DETECTED');
});

// --------------------------------------------------------------------------
// End-to-end: Email → Engine → ML Calibration attached to the single-verify
// result, WITHOUT breaking the existing { result, credits, user } contract.
// --------------------------------------------------------------------------
test('VerifySingleEmail: attaches confidenceCalibration additively; existing contract intact', async () => {
  const users = {
    _u: { id: OWNER, credits: 10, email: 'u@u.com' },
    chargeCredits() { this._u.credits -= 1; return true; },
    findById() { return this._u; },
  };
  const fakeEngine = { verify: async (email) => ({ ...result({ email }) }) };
  const uc = new VerifySingleEmail({ users, verificationEngine: fakeEngine, calibrator: trainedCalibrator() });

  const out = await uc.execute(OWNER, 'a@good.com');
  // Existing contract preserved.
  assert.ok(out.result && 'credits' in out && 'user' in out);
  assert.equal(out.result.deliverability, 'deliverable');
  // Additive ML block present and does not replace the verdict.
  assert.ok(out.result.confidenceCalibration);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(out.result.confidenceCalibration.level));
});

test('VerifySingleEmail: works WITHOUT a calibrator (backward-compatible)', async () => {
  const users = {
    _u: { id: OWNER, credits: 10, email: 'u@u.com' },
    chargeCredits() { return true; },
    findById() { return this._u; },
  };
  const fakeEngine = { verify: async (email) => ({ ...result({ email }) }) };
  const uc = new VerifySingleEmail({ users, verificationEngine: fakeEngine }); // no calibrator
  const out = await uc.execute(OWNER, 'a@good.com');
  assert.ok(out.result);
  assert.equal(out.result.confidenceCalibration, undefined); // additive: simply absent
});

test('VerifySingleEmail: a calibrator that throws never breaks verification', async () => {
  const users = {
    _u: { id: OWNER, credits: 10 },
    chargeCredits() { return true; },
    findById() { return this._u; },
  };
  const fakeEngine = { verify: async (email) => ({ ...result({ email }) }) };
  const brokenCalibrator = { calibrate() { throw new Error('boom'); } };
  const uc = new VerifySingleEmail({ users, verificationEngine: fakeEngine, calibrator: brokenCalibrator });
  const out = await uc.execute(OWNER, 'a@good.com');
  assert.ok(out.result); // verification still succeeds
  assert.equal(out.result.confidenceCalibration, undefined);
});
