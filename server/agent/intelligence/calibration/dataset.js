// ML Confidence Calibration — Training / Benchmark Dataset builder.
//
// PURE module. Turns benchmark evidence into a standardized, leakage-aware
// dataset the model can learn from. It NEVER fabricates labels: every record's
// label comes from an explicit ground-truth / reference source that the caller
// supplied. When no trustworthy label exists the record is dropped (or marked
// UNKNOWN) — we never guess.
//
// The learning target is NOT "is the email valid". It is:
//     y = "was the deterministic verdict CORRECT given ground truth?"  (1/0)
// i.e. the model estimates P(correct verdict | evidence) — reliability of the
// classification, not mailbox validity.

import { extractFeatures, toDeliverability, FEATURE_NAMES } from './features.js';
import { domainOf } from '../common.js';

// Trust hierarchy for the label source. Higher = more trustworthy. A provider
// is NEVER treated as absolute truth (see MEASURED disagreement in metrics).
export const GROUND_TRUTH_SOURCE = Object.freeze({
  GROUND_TRUTH: 'GROUND_TRUTH',   // trusted manual / controlled test address
  REFERENCE: 'REFERENCE',         // established external verification provider
  HEURISTIC: 'HEURISTIC',         // repeated verification agreement, etc.
  UNKNOWN: 'UNKNOWN',             // no trustworthy label — excluded from training
});

// A single standardized record, matching the task's required shape plus the
// derived learning target.
function makeRecord({ features, byName, mailhealthVerdict, referenceVerdict, groundTruth, source, timestamp, email, detConfidence }) {
  const gt = toDeliverability(groundTruth);
  const mh = toDeliverability(mailhealthVerdict);
  // Correctness label: did the engine's verdict match ground truth?
  // 'unknown' engine verdict is NOT scored as wrong — it is an abstention and
  // excluded from the correctness target (kept only for reference).
  const scorable = mh !== 'unknown' && gt !== 'unknown';
  const correct = scorable ? (mh === gt ? 1 : 0) : null;
  return {
    features: byName,        // named for transparency
    vector: features,        // ordered for the model
    mailhealthVerdict: mh,
    referenceVerdict: referenceVerdict ? toDeliverability(referenceVerdict) : '',
    groundTruth: gt,
    groundTruthSource: source,
    label: correct,          // 1 = engine correct, 0 = engine wrong, null = abstain
    scorable,
    // Engine's own confidence string (high|medium|low|unknown) for rule-vs-ML
    // baseline comparison in the train script — not a model feature.
    detConfidence: detConfidence || 'unknown',
    timestamp: timestamp || new Date().toISOString(),
    email: email || null,
    domain: domainOf(email || ''),
  };
}

/**
 * Build a dataset from an array of evidence records. Each input item must carry
 * the deterministic result plus an explicit ground-truth label from a named
 * source. Nothing is invented.
 *
 * @param {Array<object>} items each: {
 *     result,                 // engine result / contact (source of features + verdict)
 *     groundTruth,            // explicit label (required to be scorable)
 *     groundTruthSource,      // one of GROUND_TRUTH_SOURCE
 *     referenceVerdict?,      // optional external-provider verdict
 *     previousVerdict?,       // optional prior verdict (feature)
 *     timestamp?, email?, now?
 *   }
 * @returns {{ records:Array, scorable:number, dropped:number, sources:object }}
 */
export function buildDataset(items = []) {
  const records = [];
  const sources = {};
  let dropped = 0;

  for (const it of Array.isArray(items) ? items : []) {
    const result = it.result || it;
    const source = it.groundTruthSource || GROUND_TRUTH_SOURCE.UNKNOWN;
    // No trustworthy label -> cannot be a training target. Never fabricate one.
    if (!it.groundTruth || source === GROUND_TRUTH_SOURCE.UNKNOWN) {
      dropped++;
      continue;
    }
    const { vector, byName } = extractFeatures(result, {
      previousVerdict: it.previousVerdict,
      now: it.now,
    });
    const rec = makeRecord({
      features: vector,
      byName,
      mailhealthVerdict: result.deliverability || result.status || it.mailhealthVerdict,
      referenceVerdict: it.referenceVerdict,
      groundTruth: it.groundTruth,
      source,
      timestamp: it.timestamp || result.verified_at,
      email: it.email || result.email,
      detConfidence: String(result.confidence || it.detConfidence || 'unknown').toLowerCase(),
    });
    sources[source] = (sources[source] || 0) + 1;
    records.push(rec);
  }

  const scorable = records.filter((r) => r.scorable).length;
  return { records, scorable, dropped, sources, featureNames: FEATURE_NAMES };
}

// Deterministic string hash (FNV-1a) -> [0,1). Used for reproducible,
// leakage-aware group assignment keyed by domain so the same domain never
// straddles train/test.
function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Split scorable records into train / validation / test WITHOUT leaking a
 * domain across splits. Assignment is deterministic (hash of the grouping key)
 * so runs are reproducible.
 *
 * @param {Array} records  output of buildDataset().records
 * @param {object} [opts]
 * @param {number} [opts.trainRatio=0.6]
 * @param {number} [opts.valRatio=0.2]   (test = remainder)
 * @param {'domain'|'email'} [opts.groupBy='domain']
 */
export function splitDataset(records, opts = {}) {
  const trainRatio = opts.trainRatio ?? 0.6;
  const valRatio = opts.valRatio ?? 0.2;
  const groupBy = opts.groupBy || 'domain';
  const scorable = (records || []).filter((r) => r.scorable);

  const train = [], validation = [], test = [];
  for (const r of scorable) {
    const key = groupBy === 'email' ? (r.email || r.domain) : (r.domain || r.email || '');
    const h = hash01(key || Math.random().toString());
    if (h < trainRatio) train.push(r);
    else if (h < trainRatio + valRatio) validation.push(r);
    else test.push(r);
  }
  return { train, validation, test };
}

// Convenience: derive a benchmark.results-style array ({expected,predicted})
// from standardized records, so the EXISTING analyzeBenchmark (Module 13) can
// consume the same dataset. Bridges the two vocabularies noted in the codebase.
export function toBenchmarkResults(records) {
  return (records || [])
    .filter((r) => r.scorable)
    .map((r) => ({
      email: r.email,
      expected: r.groundTruth,
      predicted: r.mailhealthVerdict,
      reason: r.mailhealthVerdict === r.groundTruth ? undefined : firstRiskReason(r),
    }));
}

function firstRiskReason(r) {
  if (r.features.catch_all) return 'catch_all';
  if (r.features.greylisted) return 'greylisting';
  if (!r.features.smtp_connected) return 'smtp_unavailable';
  if (r.features.provider_agreement < 0) return 'provider_disagreement';
  return 'other';
}
