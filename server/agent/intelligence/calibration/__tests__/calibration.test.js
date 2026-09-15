// Tests for the ML Confidence Calibration layer. Uses the Node built-in test
// runner (node --test), matching the rest of the project. No network, no LLM.
//
// Covers (task §22): feature extraction, dataset generation, model training,
// model loading, inference, probability calibration, confidence mapping,
// missing features, conflicting signals, insufficient data, model unavailable,
// model versioning, drift detection, benchmark evaluation, and fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FEATURE_NAMES, extractFeatures, evidenceBullets,
  buildDataset, splitDataset, toBenchmarkResults, GROUND_TRUTH_SOURCE,
  trainModel, predictProba, isUsable, featureImportance, explainPrediction, MODEL_VERSION,
  evaluate, reliabilityCurve, compareRuleVsMl,
  toLevel, selectThresholds, DEFAULT_THRESHOLDS, LEVEL,
  detectDisagreement, detectDrift,
  ConfidenceCalibrator, loadModel, saveModel,
} from '../index.js';

import {
  result, catchAllResult, disposableResult, unknownResult, labelledDataset,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------
test('extractFeatures: fixed-order vector length matches FEATURE_NAMES', () => {
  const { vector, byName } = extractFeatures(result());
  assert.equal(vector.length, FEATURE_NAMES.length);
  assert.equal(Object.keys(byName).length, FEATURE_NAMES.length);
});

test('extractFeatures: confirmed mailbox reads positive SMTP facts', () => {
  const { byName } = extractFeatures(result());
  assert.equal(byName.syntax_valid, 1);
  assert.equal(byName.domain_exists, 1);
  assert.equal(byName.mx_exists, 1);
  assert.equal(byName.smtp_connected, 1);
  assert.equal(byName.smtp_accept, 1);
  assert.equal(byName.deliverable_verdict, 1);
});

test('extractFeatures: catch-all is encoded and lowers independent confirmation', () => {
  const { byName } = extractFeatures(catchAllResult());
  assert.equal(byName.catch_all, 1);
  assert.equal(byName.smtp_accept, 0); // never confirmed for catch-all
  assert.equal(byName.risky_verdict, 1);
});

test('extractFeatures: disposable encodes cleanly as undeliverable', () => {
  const { byName } = extractFeatures(disposableResult());
  assert.equal(byName.disposable, 1);
  assert.equal(byName.undeliverable_verdict, 1);
});

test('extractFeatures: MISSING FEATURES — empty/garbage input yields a valid zero vector, never throws', () => {
  for (const bad of [null, undefined, {}, 42, 'nope']) {
    const { vector } = extractFeatures(bad);
    assert.equal(vector.length, FEATURE_NAMES.length);
    assert.ok(vector.every((x) => Number.isFinite(x)));
  }
});

test('extractFeatures: CONFLICTING SIGNALS — never fabricated, encoded as given', () => {
  // A result that claims "deliverable" but has NO smtp confirmation evidence.
  const weird = result({
    signals: [{ status: 'pass', label: 'Valid syntax' }, { status: 'pass', label: 'Domain exists' }],
  });
  const { byName } = extractFeatures(weird);
  assert.equal(byName.deliverable_verdict, 1);
  assert.equal(byName.smtp_accept, 0); // we did NOT invent a confirmation
});

test('evidenceBullets: returns signed, human-readable evidence', () => {
  const bullets = evidenceBullets(catchAllResult());
  assert.ok(Array.isArray(bullets) && bullets.length > 0);
  assert.ok(bullets.some((b) => /catch-all/i.test(b.text) && b.sign === '-'));
});

// ---------------------------------------------------------------------------
// Dataset generation
// ---------------------------------------------------------------------------
test('buildDataset: DROPS records without a trustworthy label (never fabricates)', () => {
  const ds = buildDataset([
    { result: result(), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH },
    { result: result() }, // no label -> dropped
    { result: result(), groundTruthSource: GROUND_TRUTH_SOURCE.UNKNOWN, groundTruth: 'deliverable' }, // unknown source -> dropped
  ]);
  assert.equal(ds.records.length, 1);
  assert.equal(ds.dropped, 2);
});

test('buildDataset: preserves engine confidence as detConfidence for rule baseline', () => {
  const ds = buildDataset([
    { result: result({ confidence: 'high' }), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH },
    { result: catchAllResult({ confidence: 'medium' }), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.REFERENCE },
  ]);
  assert.equal(ds.records[0].detConfidence, 'high');
  assert.equal(ds.records[1].detConfidence, 'medium');
});

test('buildDataset: label is correctness of verdict, not validity; unknown verdict abstains', () => {
  const ds = buildDataset([
    { result: result(), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH }, // correct -> 1
    { result: catchAllResult(), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.REFERENCE }, // risky vs deliverable -> 0
    { result: unknownResult(), groundTruth: 'deliverable', groundTruthSource: GROUND_TRUTH_SOURCE.GROUND_TRUTH }, // unknown verdict -> abstain (null)
  ]);
  assert.equal(ds.records[0].label, 1);
  assert.equal(ds.records[1].label, 0);
  assert.equal(ds.records[2].label, null);
  assert.equal(ds.records[2].scorable, false);
});

test('splitDataset: domain-grouped split keeps a domain out of multiple splits (no leakage)', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train, validation, test: te } = splitDataset(ds.records, { groupBy: 'domain' });
  const domSplit = new Map();
  for (const [name, rows] of [['train', train], ['val', validation], ['test', te]]) {
    for (const r of rows) {
      if (domSplit.has(r.domain)) assert.equal(domSplit.get(r.domain), name, `domain ${r.domain} leaked across splits`);
      domSplit.set(r.domain, name);
    }
  }
  assert.ok(train.length > 0 && te.length > 0);
});

test('toBenchmarkResults: bridges standardized records to analyzeBenchmark shape', () => {
  const ds = buildDataset(labelledDataset(30));
  const rows = toBenchmarkResults(ds.records);
  assert.ok(rows.every((r) => 'expected' in r && 'predicted' in r));
});

// ---------------------------------------------------------------------------
// Model training / inference / versioning
// ---------------------------------------------------------------------------
test('trainModel: INSUFFICIENT DATA returns an honest untrained model', () => {
  const m = trainModel([{ vector: FEATURE_NAMES.map(() => 0), label: 1 }], { minSamples: 20 });
  assert.equal(m.trained, false);
  assert.equal(m.reason, 'insufficient-data');
  assert.equal(isUsable(m), false);
});

test('trainModel: trains a usable, versioned model on sufficient data', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const m = trainModel(train, { minSamples: 20 });
  assert.equal(m.trained, true);
  assert.equal(m.version, MODEL_VERSION);
  assert.ok(isUsable(m));
  assert.equal(m.weights.length, FEATURE_NAMES.length);
});

test('trainModel: REPRODUCIBLE — same seed + data => identical weights', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const a = trainModel(train, { seed: 7 });
  const b = trainModel(train, { seed: 7 });
  assert.deepEqual(a.weights, b.weights);
  assert.equal(a.bias, b.bias);
});

test('predictProba: returns a probability in [0,1] and separates clear cases', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const m = trainModel(train);
  const pGood = predictProba(m, extractFeatures(result()).vector);
  const pCatch = predictProba(m, extractFeatures(catchAllResult()).vector);
  for (const p of [pGood, pCatch]) { assert.ok(p >= 0 && p <= 1); }
  // Confirmed-mailbox reliability should exceed catch-all reliability.
  assert.ok(pGood > pCatch, `expected confirmed (${pGood}) > catch-all (${pCatch})`);
});

test('predictProba: feature-shape mismatch throws (guarded by caller/fallback)', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const m = trainModel(train);
  assert.throws(() => predictProba(m, [1, 2, 3]));
});

test('featureImportance & explainPrediction: interpretable outputs', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const m = trainModel(train);
  const imp = featureImportance(m);
  assert.equal(imp.length, FEATURE_NAMES.length);
  assert.ok(imp[0].importance >= imp[imp.length - 1].importance);
  const contribs = explainPrediction(m, extractFeatures(catchAllResult()).vector, 3);
  assert.ok(contribs.length <= 3);
});

// ---------------------------------------------------------------------------
// Calibration metrics
// ---------------------------------------------------------------------------
test('evaluate: computes accuracy, Brier, ECE, confusion on labelled predictions', () => {
  const preds = [
    { p: 0.9, y: 1 }, { p: 0.8, y: 1 }, { p: 0.2, y: 0 }, { p: 0.1, y: 0 },
    { p: 0.6, y: 1 }, { p: 0.4, y: 0 },
  ];
  const m = evaluate(preds, 0.5);
  assert.equal(m.available, true);
  assert.ok(m.brierScore >= 0 && m.brierScore <= 1);
  assert.ok(m.expectedCalibrationError >= 0);
  assert.equal(m.confusionMatrix.tp + m.confusionMatrix.tn + m.confusionMatrix.fp + m.confusionMatrix.fn, 6);
});

test('evaluate: empty input is handled', () => {
  assert.equal(evaluate([]).available, false);
});

test('reliabilityCurve: buckets predictions and reports predicted vs actual', () => {
  const preds = Array.from({ length: 50 }, (_, i) => ({ p: i / 50, y: i / 50 > 0.5 ? 1 : 0 }));
  const curve = reliabilityCurve(preds, 10);
  assert.ok(curve.every((b) => 'predictedConfidence' in b && 'actualCorrectness' in b));
});

test('compareRuleVsMl: recommends deploy only when ML improves calibration', () => {
  const rule = Array.from({ length: 40 }, (_, i) => ({ p: 0.7, y: i % 4 === 0 ? 0 : 1 }));
  const ml = Array.from({ length: 40 }, (_, i) => ({ p: i % 4 === 0 ? 0.3 : 0.85, y: i % 4 === 0 ? 0 : 1 }));
  const cmp = compareRuleVsMl({ rulePreds: rule, mlPreds: ml });
  assert.ok('recommendDeploy' in cmp.verdict);
});

// ---------------------------------------------------------------------------
// Confidence mapping
// ---------------------------------------------------------------------------
test('toLevel: maps probability to HIGH/MEDIUM/LOW using thresholds', () => {
  assert.equal(toLevel(0.95), LEVEL.HIGH);
  assert.equal(toLevel(0.75), LEVEL.MEDIUM);
  assert.equal(toLevel(0.5), LEVEL.LOW);
  assert.equal(toLevel(NaN), LEVEL.LOW);
});

test('selectThresholds: uses defaults when validation data is insufficient', () => {
  const t = selectThresholds([{ p: 0.9, y: 1 }]);
  assert.equal(t.source, 'default');
  assert.equal(t.high, DEFAULT_THRESHOLDS.high);
});

test('selectThresholds: derives thresholds from validation data with a rationale', () => {
  const val = [];
  for (let i = 0; i < 100; i++) val.push({ p: 0.95, y: i < 96 ? 1 : 0 }); // 96% correct high band
  for (let i = 0; i < 100; i++) val.push({ p: 0.4, y: i < 40 ? 1 : 0 });
  const t = selectThresholds(val);
  assert.equal(t.source, 'validation');
  assert.ok(t.high >= t.medium);
  assert.ok(typeof t.rationale === 'string' && t.rationale.length > 0);
});

// ---------------------------------------------------------------------------
// Disagreement detection
// ---------------------------------------------------------------------------
test('detectDisagreement: LOW confidence on a decisive verdict is a hard review case', () => {
  const d = detectDisagreement({ verdict: 'deliverable', recommendedAction: 'keep', probability: 0.55, level: LEVEL.LOW });
  assert.equal(d.disagreement, true);
  assert.equal(d.severity, 'hard');
  assert.equal(d.reviewCase, true);
  assert.ok(/review/i.test(d.warning));
});

test('detectDisagreement: HIGH confidence on a decisive verdict is NOT a disagreement', () => {
  const d = detectDisagreement({ verdict: 'undeliverable', recommendedAction: 'remove', probability: 0.95, level: LEVEL.HIGH });
  assert.equal(d.disagreement, false);
  assert.equal(d.severity, 'none');
});

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------
test('detectDrift: needs both windows; advisory only', () => {
  const none = detectDrift({ baseline: null, recent: null });
  assert.equal(none.available, false);
});

test('detectDrift: flags degradation as MODEL DRIFT DETECTED and recommends retraining', () => {
  const d = detectDrift({
    baseline: { brierScore: 0.10, accuracy: 90, falsePositiveRate: 5, falseNegativeRate: 5 },
    recent: { brierScore: 0.20, accuracy: 80, falsePositiveRate: 12, falseNegativeRate: 6 },
  });
  assert.equal(d.drift, true);
  assert.equal(d.status, 'MODEL DRIFT DETECTED');
  assert.ok(/retrain/i.test(d.recommendation));
});

test('detectDrift: stable windows report STABLE, no recommendation', () => {
  const d = detectDrift({
    baseline: { brierScore: 0.10, accuracy: 90, falsePositiveRate: 5, falseNegativeRate: 5 },
    recent: { brierScore: 0.11, accuracy: 89, falsePositiveRate: 6, falseNegativeRate: 5 },
  });
  assert.equal(d.drift, false);
  assert.equal(d.status, 'STABLE');
});

// ---------------------------------------------------------------------------
// Loader / model unavailable / corrupted
// ---------------------------------------------------------------------------
test('loadModel: missing file returns null', () => {
  assert.equal(loadModel(path.join(os.tmpdir(), 'does-not-exist-xyz.json')), null);
});

test('loadModel: corrupted JSON returns an untrained/corrupted marker', () => {
  const p = path.join(os.tmpdir(), `cal-corrupt-${Date.now()}.json`);
  fs.writeFileSync(p, '{ not valid json');
  const m = loadModel(p);
  assert.equal(m.trained, false);
  assert.equal(m.reason, 'corrupted');
  fs.unlinkSync(p);
});

test('saveModel + loadModel round-trip a trained model', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const m = trainModel(train);
  const p = path.join(os.tmpdir(), `cal-model-${Date.now()}.json`);
  saveModel(m, p);
  const loaded = loadModel(p);
  assert.ok(isUsable(loaded));
  assert.deepEqual(loaded.weights, m.weights);
  fs.unlinkSync(p);
});

// ---------------------------------------------------------------------------
// Calibrator: end-to-end + FALLBACK behaviour
// ---------------------------------------------------------------------------
test('ConfidenceCalibrator: FALLBACK when no model — uses deterministic confidence, never throws', () => {
  const cal = new ConfidenceCalibrator({ model: null });
  assert.equal(cal.ready(), false);
  const out = cal.calibrate(result());
  assert.equal(out.available, false);
  assert.equal(out.source, 'rule-engine');
  assert.equal(out.model, 'deterministic-fallback');
  assert.equal(out.level, LEVEL.HIGH); // engine confidence was 'high'
  assert.ok(out.message.includes('UNAVAILABLE'));
});

test('ConfidenceCalibrator: FALLBACK on untrained (insufficient-data) model', () => {
  const cal = new ConfidenceCalibrator({ model: { version: MODEL_VERSION, trained: false, reason: 'insufficient-data' } });
  const st = cal.status();
  assert.equal(st.available, false);
  assert.ok(/Insufficient validated benchmark samples/i.test(st.message));
  const out = cal.calibrate(result());
  assert.equal(out.available, false);
});

test('ConfidenceCalibrator: ML path attaches calibrated block WITHOUT touching the verdict', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const model = trainModel(train);
  const cal = new ConfidenceCalibrator({ model });

  const det = result();
  const before = JSON.stringify(det);
  const out = cal.calibrate(det);

  // Verdict object is untouched.
  assert.equal(JSON.stringify(det), before);
  assert.equal(out.available, true);
  assert.equal(out.source, 'rule+ml');
  assert.equal(out.model, MODEL_VERSION);
  assert.ok(out.score >= 0 && out.score <= 1);
  assert.ok([LEVEL.HIGH, LEVEL.MEDIUM, LEVEL.LOW].includes(out.level));
  assert.ok(Array.isArray(out.evidence));
  assert.ok(typeof out.interpretation === 'string');
});

test('ConfidenceCalibrator: minPerformance gate forces fallback when below bar', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const model = trainModel(train);
  model.performance = { accuracy: 40 };
  const cal = new ConfidenceCalibrator({ model, minPerformance: 80 });
  assert.equal(cal.ready(), false);
  assert.equal(cal.calibrate(result()).available, false);
});

test('ConfidenceCalibrator: catch-all yields lower reliability than a confirmed mailbox', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const cal = new ConfidenceCalibrator({ model: trainModel(train) });
  const good = cal.calibrate(result());
  const risky = cal.calibrate(catchAllResult());
  assert.ok(good.score >= risky.score);
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------
test('model versioning: every prediction carries a model version', () => {
  const ds = buildDataset(labelledDataset(180));
  const { train } = splitDataset(ds.records, { groupBy: 'domain' });
  const cal = new ConfidenceCalibrator({ model: trainModel(train) });
  const out = cal.calibrate(result());
  assert.equal(out.model, MODEL_VERSION);
});
