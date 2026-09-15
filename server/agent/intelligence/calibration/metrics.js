// ML Confidence Calibration — Evaluation metrics.
//
// PURE module. Given predictions [{ p, y }] where p in [0,1] is the model's
// estimated P(correct) and y in {0,1} is whether the engine verdict was
// actually correct, compute classification + CALIBRATION quality. The goal is
// well-calibrated confidence, not merely a high score.

import { round1, pct } from '../common.js';

function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

/**
 * @param {Array<{p:number,y:0|1}>} preds
 * @param {number} [threshold=0.5] decision threshold for confusion matrix
 */
export function evaluate(preds, threshold = 0.5) {
  const rows = (preds || []).filter((r) => r && Number.isFinite(r.p) && (r.y === 0 || r.y === 1));
  const n = rows.length;
  if (n === 0) {
    return { available: false, n: 0, message: 'No labelled predictions to evaluate.' };
  }

  let tp = 0, tn = 0, fp = 0, fn = 0, brier = 0, logloss = 0;
  for (const { p, y } of rows) {
    const pred = p >= threshold ? 1 : 0;
    if (pred === 1 && y === 1) tp++;
    else if (pred === 0 && y === 0) tn++;
    else if (pred === 1 && y === 0) fp++;
    else fn++;
    brier += (p - y) * (p - y);
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p));
    logloss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
  }
  brier /= n;
  logloss /= n;

  const accuracy = (tp + tn) / n;
  const precision = (tp + fp) ? tp / (tp + fp) : 0;
  const recall = (tp + fn) ? tp / (tp + fn) : 0;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;

  const reliability = reliabilityCurve(rows, 10);
  const ece = expectedCalibrationError(reliability, n);

  return {
    available: true,
    n,
    threshold,
    accuracy: round1(accuracy * 100),
    precision: round1(precision * 100),
    recall: round1(recall * 100),
    f1: round1(f1 * 100),
    brierScore: round3(brier),
    logLoss: round3(logloss),
    expectedCalibrationError: round3(ece),
    confusionMatrix: { tp, tn, fp, fn },
    falsePositiveRate: (fp + tn) ? round1((fp / (fp + tn)) * 100) : 0,
    falseNegativeRate: (fn + tp) ? round1((fn / (fn + tp)) * 100) : 0,
    reliability,
  };
}

// Bin predictions into `bins` equal-width buckets and compare mean predicted
// probability against observed accuracy per bucket (the calibration curve).
export function reliabilityCurve(preds, bins = 10) {
  const buckets = Array.from({ length: bins }, (_, i) => ({
    bin: i,
    lo: round1((i / bins) * 100),
    hi: round1(((i + 1) / bins) * 100),
    count: 0, sumP: 0, sumY: 0,
  }));
  for (const { p, y } of preds || []) {
    if (!Number.isFinite(p)) continue;
    let idx = Math.floor(p * bins);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count++;
    buckets[idx].sumP += p;
    buckets[idx].sumY += (y === 1 ? 1 : 0);
  }
  return buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      range: `${b.lo}-${b.hi}%`,
      count: b.count,
      predictedConfidence: round1((b.sumP / b.count) * 100),
      actualCorrectness: round1((b.sumY / b.count) * 100),
    }));
}

function expectedCalibrationError(reliability, total) {
  if (!total) return 0;
  let ece = 0;
  for (const b of reliability) {
    const gap = Math.abs(b.predictedConfidence - b.actualCorrectness) / 100;
    ece += (b.count / total) * gap;
  }
  return ece;
}

// Compare the deterministic engine's own confidence quality against the
// rule+ML calibrated confidence, to PROVE whether ML improves things. Both are
// scored on the same held-out set. If ML does not improve, do not deploy it.
export function compareRuleVsMl({ rulePreds, mlPreds }) {
  const rule = evaluate(rulePreds);
  const ml = evaluate(mlPreds);
  const improved = rule.available && ml.available &&
    ml.brierScore <= rule.brierScore &&
    ml.expectedCalibrationError <= rule.expectedCalibrationError;
  return {
    ruleEngine: rule,
    rulePlusMl: ml,
    verdict: {
      brierImproved: rule.available && ml.available ? ml.brierScore <= rule.brierScore : null,
      eceImproved: rule.available && ml.available ? ml.expectedCalibrationError <= rule.expectedCalibrationError : null,
      recommendDeploy: improved,
      note: improved
        ? 'ML calibration improves (or matches) both Brier score and calibration error; deployment is justified.'
        : 'ML calibration does not clearly improve confidence quality; keep deterministic confidence.',
    },
  };
}
