#!/usr/bin/env node
// Train the ML Confidence Calibration model from a labelled benchmark dataset.
//
// This NEVER fabricates data. It requires a dataset where every record carries
// an explicit ground-truth label from a named, trustworthy source. Given
// insufficient data it writes an honest "untrained" artifact so the running
// system reports "ML Confidence Calibration: UNAVAILABLE" and keeps using the
// deterministic engine.
//
// The workflow is: New Data → Ground Truth → Dataset → Train → Validate →
// Compare → (manual approval) → Deploy. This script produces a CANDIDATE and
// reports metrics; deploying (overwriting the active model) is an explicit,
// human-reviewed step (--deploy).
//
// Usage:
//   node scripts/train-calibration.mjs <dataset.json> [--deploy] [--out path]
//
// Dataset format (array of records):
//   [{
//     "result": { ...deterministic engine result or contact... },
//     "groundTruth": "deliverable|undeliverable|risky|unknown" (or safe/remove/review),
//     "groundTruthSource": "GROUND_TRUTH|REFERENCE|HEURISTIC",
//     "referenceVerdict": "...(optional external provider)...",
//     "previousVerdict": "...(optional)...",
//     "email": "...", "timestamp": "..."
//   }, ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDataset, splitDataset,
  trainModel, predictProba,
  evaluate, selectThresholds, compareRuleVsMl,
  DEFAULT_MODEL_PATH, saveModel, MODEL_VERSION,
} from '../server/agent/intelligence/calibration/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || true);
}

function untrained(reason, samples) {
  return { version: MODEL_VERSION, kind: 'logistic-regression', trained: false, reason, samples: samples || 0, createdAt: new Date().toISOString() };
}

async function main() {
  const datasetPath = process.argv[2];
  if (!datasetPath || datasetPath.startsWith('--') || !fs.existsSync(datasetPath)) {
    console.error('\nUsage: node scripts/train-calibration.mjs <dataset.json> [--deploy] [--out path]');
    console.error('See file header for dataset format.\n');
    process.exit(1);
  }

  const deploy = !!arg('--deploy');
  const outPath = arg('--out') || (deploy ? DEFAULT_MODEL_PATH : path.join(__dirname, '..', 'server', 'agent', 'intelligence', 'calibration', 'models', `${MODEL_VERSION}.candidate.json`));

  const items = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const ds = buildDataset(items);
  console.log(`\nDataset: ${items.length} input record(s) → ${ds.records.length} kept, ${ds.scorable} scorable, ${ds.dropped} dropped (no trustworthy label).`);
  console.log(`Ground-truth sources: ${JSON.stringify(ds.sources)}`);

  const MIN_SCORABLE = 20;
  if (ds.scorable < MIN_SCORABLE) {
    console.warn(`\nInsufficient validated benchmark samples (${ds.scorable} < ${MIN_SCORABLE}). Writing UNAVAILABLE artifact; deterministic confidence remains in use.`);
    saveModel(untrained('insufficient-data', ds.scorable), outPath);
    console.log(`Wrote: ${outPath}`);
    process.exit(0);
  }

  const { train, validation, test } = splitDataset(ds.records, { groupBy: 'domain' });
  console.log(`Splits (domain-grouped, no leakage): train=${train.length}, val=${validation.length}, test=${test.length}`);

  const model = trainModel(train, { minSamples: 20 });
  if (!model.trained) {
    console.warn(`\nTraining aborted: ${model.reason}. Writing UNAVAILABLE artifact.`);
    saveModel(untrained(model.reason, train.length), outPath);
    process.exit(0);
  }

  // Threshold selection on VALIDATION only (no leakage from test).
  const valPreds = validation.map((r) => ({ p: predictProba(model, r.vector), y: r.label }));
  const thresholds = selectThresholds(valPreds);
  model.thresholds = { high: thresholds.high, medium: thresholds.medium };
  model.thresholdSelection = thresholds;

  // Held-out TEST metrics.
  const testPreds = test.map((r) => ({ p: predictProba(model, r.vector), y: r.label }));
  const perf = evaluate(testPreds, 0.5);
  model.performance = {
    accuracy: perf.accuracy, precision: perf.precision, recall: perf.recall, f1: perf.f1,
    brierScore: perf.brierScore, expectedCalibrationError: perf.expectedCalibrationError,
    falsePositiveRate: perf.falsePositiveRate, falseNegativeRate: perf.falseNegativeRate,
    n: perf.n,
  };

  // Rule-engine baseline confidence quality, for a fair comparison. The engine
  // maps high/medium/low to nominal probabilities; we score both on TEST.
  const detP = { high: 0.92, medium: 0.75, low: 0.5, unknown: 0.4 };
  const rulePreds = test.map((r) => {
    const c = String(r.features && r.detConfidence || 'unknown');
    return { p: detP[c] ?? 0.4, y: r.label };
  });
  const comparison = compareRuleVsMl({ rulePreds, mlPreds: testPreds });

  console.log('\n── Model performance (held-out test) ──────────');
  console.table(model.performance);
  console.log('Selected thresholds:', model.thresholds, `(${thresholds.source})`);
  console.log('Rationale:', thresholds.rationale);
  console.log('\n── Rule vs Rule+ML ────────────────────────────');
  console.log(JSON.stringify(comparison.verdict, null, 2));

  saveModel(model, outPath);
  console.log(`\nWrote ${deploy ? 'DEPLOYED' : 'CANDIDATE'} model: ${outPath}`);
  if (!deploy) console.log('Review metrics above, then re-run with --deploy to activate.');
  if (deploy && !comparison.verdict.recommendDeploy) {
    console.warn('WARNING: deployed a model that does not clearly beat deterministic confidence. Reconsider.');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
