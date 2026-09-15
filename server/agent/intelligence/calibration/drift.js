// ML Confidence Calibration — Model drift detection.
//
// PURE module. Compares a RECENT window of calibration outcomes against the
// model's training-time baseline (or a reference window) to detect drift. It
// only RECOMMENDS retraining — it NEVER silently retrains or swaps a model in
// production (that requires validation + manual approval, see the training
// workflow).

import { round1, pct } from '../common.js';

/**
 * @param {object} args
 * @param {object} [args.baseline]  { brierScore, accuracy, meanConfidence, falsePositiveRate, falseNegativeRate }
 * @param {object} [args.recent]    same shape, computed over a recent window
 * @param {object} [args.thresholds]
 * @returns {{ drift:boolean, signals:Array<{metric,delta,detail}>, recommendation:string|null, note:string }}
 */
export function detectDrift({ baseline, recent, thresholds = {} } = {}) {
  const note = 'Drift detection is advisory. Retraining requires validation and manual approval before deployment.';
  if (!baseline || !recent) {
    return { drift: false, available: false, signals: [], recommendation: null, note, message: 'Need both baseline and recent windows to assess drift.' };
  }

  const brierWorseBy = thresholds.brierWorseBy ?? 0.05;      // absolute Brier increase
  const accDropBy = thresholds.accDropBy ?? 5;                // percentage points
  const confShiftBy = thresholds.confShiftBy ?? 10;          // pp shift in mean confidence
  const rateShiftBy = thresholds.rateShiftBy ?? 5;           // pp in FP/FN rate

  const signals = [];
  const cmp = (metric, base, cur, worseBy, dir = 'up', unit = 'pp') => {
    if (!Number.isFinite(base) || !Number.isFinite(cur)) return;
    const delta = round1(cur - base);
    const worse = dir === 'up' ? delta >= worseBy : delta <= -worseBy;
    if (worse) signals.push({ metric, delta, detail: `${metric} moved from ${base} to ${cur} (${delta > 0 ? '+' : ''}${delta}${unit === 'pp' ? 'pp' : ''}).` });
  };

  cmp('brierScore', baseline.brierScore, recent.brierScore, brierWorseBy, 'up', 'abs');
  cmp('accuracy', baseline.accuracy, recent.accuracy, accDropBy, 'down');
  cmp('falsePositiveRate', baseline.falsePositiveRate, recent.falsePositiveRate, rateShiftBy, 'up');
  cmp('falseNegativeRate', baseline.falseNegativeRate, recent.falseNegativeRate, rateShiftBy, 'up');

  if (Number.isFinite(baseline.meanConfidence) && Number.isFinite(recent.meanConfidence)) {
    const delta = round1(recent.meanConfidence - baseline.meanConfidence);
    if (Math.abs(delta) >= confShiftBy) {
      signals.push({ metric: 'meanConfidence', delta, detail: `Confidence distribution shifted by ${delta > 0 ? '+' : ''}${delta}pp.` });
    }
  }

  // New-domain / provider-disagreement pressure, if supplied.
  if (Number.isFinite(recent.newDomainRate) && recent.newDomainRate >= (thresholds.newDomainRate ?? 40)) {
    signals.push({ metric: 'newDomainRate', delta: round1(recent.newDomainRate), detail: `High share of previously-unseen domains (${round1(recent.newDomainRate)}%).` });
  }
  if (Number.isFinite(recent.providerDisagreementRate) && Number.isFinite(baseline.providerDisagreementRate)) {
    const delta = round1(recent.providerDisagreementRate - baseline.providerDisagreementRate);
    if (delta >= rateShiftBy) signals.push({ metric: 'providerDisagreementRate', delta, detail: `Provider disagreement rising (+${delta}pp).` });
  }

  const drift = signals.length > 0;
  return {
    available: true,
    drift,
    status: drift ? 'MODEL DRIFT DETECTED' : 'STABLE',
    signals,
    recommendation: drift
      ? 'MODEL DRIFT DETECTED — schedule a retraining candidate, validate it against a held-out set, and require manual approval before deploying.'
      : null,
    note,
  };
}
