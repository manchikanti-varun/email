// Health-cluster intelligence: campaign risk, list-health analysis, and
// health prediction. All pure. Inputs are deterministic (stats + history +
// preflight); outputs separate FACT / INFERENCE / PREDICTION / RECOMMENDATION
// and carry confidence. Never claims guaranteed inbox placement.
import {
  KIND, CONFIDENCE, RISK_LEVEL, INSUFFICIENT,
  fact, inference, prediction, recommendation,
  clampScore, round1, linearFit, safeNum,
} from './common.js';
import { snapshotDelta } from './statistics.js';

// ---- MODULE 1: Campaign Risk Predictor ------------------------------------
// Answers "Can I safely send this campaign?" from measured buckets + trend.
export function campaignRisk({ stats, preflight, history }) {
  if (!stats || stats.total === 0) {
    return { available: false, message: INSUFFICIENT, reasoning: [], keyRisks: [], recommendations: [] };
  }
  const total = stats.total;
  const c = stats.classification;
  const safe = safeNum(c.safe), review = safeNum(c.review), remove = safeNum(c.remove), unknown = safeNum(c.unknown);
  const catchAll = safeNum(stats.risk.catch_all);
  const disposable = safeNum(stats.risk.disposable);
  const role = safeNum(stats.risk.role_based);

  const safePct = round1((safe / total) * 100);
  const problemPct = round1(((review + remove + unknown) / total) * 100);
  // Share of recipients NOT in the Safe bucket. Derived from the SAME
  // classification buckets shown in the cleaning summary, so the risk card and
  // the summary always reconcile (safe + review + remove + unknown = total).
  // Catch-all contacts already live inside review/unknown, so we do NOT add
  // them again here — that previously double-counted and produced a percentage
  // that couldn't be reconciled with the buckets.
  const notSafePct = round1(((review + remove + unknown) / total) * 100);

  // Risk score 0-100 (higher = riskier). Weighted from the classification
  // buckets only (they partition the list); catch-all is a characteristic
  // already reflected in review/unknown, so it is not added separately.
  let riskScore = round1(
    (remove / total) * 100 * 0.5 +
    (unknown / total) * 100 * 0.3 +
    (review / total) * 100 * 0.2
  );

  // Trend nudges risk: a declining list is riskier than a stable one.
  const delta = snapshotDelta(history);
  if (delta && delta.healthDelta < 0) riskScore += Math.min(15, Math.abs(delta.healthDelta) * 1.5);
  riskScore = clampScore(riskScore);

  const riskLevel = riskScore >= 40 ? RISK_LEVEL.HIGH : riskScore >= 18 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;

  const reasoning = [];
  const keyRisks = [];
  reasoning.push(fact(`Of ${total} recipients: ${safe} safe (${safePct}%), ${review} review, ${remove} remove, ${unknown} unknown.`));
  if (notSafePct > 0) {
    reasoning.push(inference(
      `${notSafePct}% of recipients are not in the Safe bucket (review, remove, or unknown), so they are not campaign-ready as-is.`,
      notSafePct >= 10 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM
    ));
  }
  if (catchAll > 0) {
    reasoning.push(inference(
      `${catchAll} recipients are on catch-all domains: mail path is healthy, but individual mailboxes are unconfirmed (a characteristic, not a defect).`,
      CONFIDENCE.MEDIUM
    ));
  }
  if (remove > 0) keyRisks.push(`${remove} recipients are classified Remove (strong evidence they cannot receive mail).`);
  if (unknown > 0) keyRisks.push(`${unknown} recipients are Unknown (unconfirmed, candidates for re-verification, not sending).`);
  // Catch-all is intentionally NOT listed as a key risk — healthy accepting domain.
  if (disposable > 0) keyRisks.push(`${disposable} recipients use disposable domains.`);
  if (role > 0) keyRisks.push(`${role} recipients are role/shared mailboxes (a characteristic, not a defect).`);

  if (delta) {
    if (delta.healthDelta < 0) {
      reasoning.push(inference(
        `List health declined by ${Math.abs(delta.healthDelta)} points since the previous verification.`,
        CONFIDENCE.HIGH
      ));
    } else if (delta.healthDelta > 0) {
      reasoning.push(fact(`List health improved by ${delta.healthDelta} points since the previous verification.`));
    }
  }

  const recommendations = [];
  const recommendedSendCount = safe; // deterministic: only Safe are campaign-ready
  if (riskLevel === RISK_LEVEL.HIGH) {
    recommendations.push(recommendation('Clean the list before sending: remove the Remove bucket and re-verify Unknown addresses.', CONFIDENCE.HIGH));
  } else if (riskLevel === RISK_LEVEL.MEDIUM) {
    recommendations.push(recommendation('Send to the Safe bucket only; review or re-verify the rest before including them.', CONFIDENCE.MEDIUM));
  } else {
    recommendations.push(recommendation('The Safe bucket is healthy to send. Keep monitoring after send.', CONFIDENCE.MEDIUM));
  }
  if (preflight?.verdict) reasoning.push(fact(`Deterministic preflight verdict: ${preflight.verdict}`));

  const why = `Campaign risk is ${riskLevel} because ${notSafePct}% of recipients are not in the Safe bucket ` +
    `(${review} review, ${remove} remove, ${unknown} unknown), so only the ${safe} Safe recipients are campaign-ready` +
    (delta && delta.healthDelta < 0 ? `, and list health declined by ${Math.abs(delta.healthDelta)} points since the previous verification.` : '.') +
    ' Inbox placement is never guaranteed; this reflects list quality only.';

  return {
    available: true,
    riskLevel,
    riskScore,
    safeRecipients: safe,
    reviewRecipients: review,
    removeRecipients: remove,
    unknownRecipients: unknown,
    recommendedSendCount,
    safePct,
    problemPct,
    keyRisks,
    reasoning,
    recommendations,
    summary: why,
  };
}

// ---- MODULE 2: List Health Analyst ----------------------------------------
export function listHealthAnalysis({ summary, stats, history }) {
  if (!summary || !stats || stats.total === 0) {
    return { available: false, summary: INSUFFICIENT, majorContributors: [], positiveSignals: [], negativeSignals: [], recommendations: [] };
  }
  const health = clampScore(summary.health);
  const m = summary.metrics || {};
  const delta = snapshotDelta(history);

  let trend = 'STABLE';
  if (delta) {
    if (delta.healthDelta <= -1) trend = 'DECLINING';
    else if (delta.healthDelta >= 1) trend = 'IMPROVING';
  }

  const majorContributors = [];
  const positiveSignals = [];
  const negativeSignals = [];

  // Contributors ranked by how far each sub-metric sits below 100.
  for (const [label, key] of [['Deliverability', 'deliverability'], ['Data quality', 'dataQuality'], ['Risk', 'risk'], ['Domain health', 'domainHealth']]) {
    const v = safeNum(m[key]);
    if (v >= 90) positiveSignals.push(`${label} is strong (${v}).`);
    else if (v < 75) { majorContributors.push({ metric: label, value: v, gap: round1(100 - v) }); negativeSignals.push(`${label} is low (${v}).`); }
  }
  majorContributors.sort((a, b) => b.gap - a.gap);

  if (delta) {
    for (const [k, label] of [['remove', 'Remove'], ['unknown', 'Unknown'], ['review', 'Review'], ['safe', 'Safe']]) {
      const d = safeNum(delta.counts[k]);
      if (d > 0 && k !== 'safe') negativeSignals.push(`${label} contacts increased by ${d} since the last check.`);
      if (d > 0 && k === 'safe') positiveSignals.push(`Safe contacts increased by ${d} since the last check.`);
    }
  }

  const parts = [`List health is ${health}/100 (${trend.toLowerCase()}).`];
  if (delta && trend === 'DECLINING') {
    const drivers = ['remove', 'unknown', 'review'].map((k) => ({ k, d: safeNum(delta.counts[k]) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    if (drivers.length) parts.push(`The decline is driven mainly by more ${drivers.map((d) => `${d.k} (+${d.d})`).join(', ')}.`);
  } else if (trend === 'IMPROVING') {
    parts.push('Recent changes moved the list in a healthier direction.');
  } else if (!delta) {
    parts.push('Only one verification snapshot exists, so no trend is available yet.');
  }

  const recommendations = [];
  if (safeNum(stats.classification.remove) > 0) recommendations.push(recommendation(`Remove the ${stats.classification.remove} undeliverable contacts to lift data quality.`, CONFIDENCE.HIGH));
  if (safeNum(stats.classification.unknown) > 0) recommendations.push(recommendation(`Re-verify the ${stats.classification.unknown} unknown contacts where live SMTP is available.`, CONFIDENCE.MEDIUM));
  if (recommendations.length === 0) recommendations.push(recommendation('No cleanup needed right now; keep monitoring on your schedule.', CONFIDENCE.MEDIUM));

  return {
    available: true,
    summary: parts.join(' '),
    healthScore: health,
    trend,
    majorContributors,
    positiveSignals,
    negativeSignals,
    recommendations,
  };
}

// ---- MODULE 3: Health Prediction ------------------------------------------
// Projects future health from the historical trend. This is a PREDICTION and
// is always framed as a range, never a fact. Needs >= 3 snapshots for a
// non-trivial trend; with 2 it warns of low confidence; with < 2 it declines.
export function healthPrediction({ history }) {
  const h = (history || []).filter((s) => Number.isFinite(Number(s.health)));
  if (h.length < 2) {
    return { available: false, message: 'Insufficient historical data for reliable prediction.', currentScore: h[h.length - 1]?.health ?? null };
  }
  const points = h.map((s, i) => ({ x: i, y: Number(s.health) }));
  const fit = linearFit(points);
  const currentScore = clampScore(points[points.length - 1].y);
  if (!fit) {
    return { available: false, message: 'Insufficient historical data for reliable prediction.', currentScore };
  }

  // Snapshots are irregularly spaced; we treat one snapshot ~ one interval and
  // translate 30/60/90 days into "future snapshots" using the average spacing
  // when timestamps exist, else assume weekly (the scheduler default).
  const perDaySlope = estimatePerDaySlope(h, fit.slope);
  const project = (days) => clampScore(currentScore + perDaySlope * days);

  const p30 = project(30), p60 = project(60), p90 = project(90);
  const trend = fit.slope < -0.5 ? 'DECLINING' : fit.slope > 0.5 ? 'IMPROVING' : 'STABLE';
  const confidence = h.length >= 5 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW; // never HIGH for a forecast

  const band = confidence === CONFIDENCE.LOW ? 4 : 2.5; // +/- range
  const range = (v) => `${clampScore(v - band)}–${clampScore(v + band)}`;

  const drivers = [];
  if (trend === 'DECLINING') drivers.push('the recent downward trend in health snapshots');
  if (trend === 'IMPROVING') drivers.push('the recent upward trend in health snapshots');
  if (trend === 'STABLE') drivers.push('a broadly flat recent trend');

  let warning = '';
  if (trend === 'DECLINING' && p90 < 60) warning = 'Projected health falls below 60 within 90 days if the trend continues; schedule re-verification and cleaning.';

  return {
    available: true,
    currentScore,
    predictions: { '30d': p30, '60d': p60, '90d': p90 },
    predictionRanges: { '30d': range(p30), '60d': range(p60), '90d': range(p90) },
    trend,
    confidence,
    drivers,
    warning,
    note: `Forecast, not a fact. Based on ${h.length} snapshot(s); projected 90-day health is approximately ${range(p90)}.`,
  };
}

function estimatePerDaySlope(history, perSnapshotSlope) {
  // Average day-gap between snapshots when timestamps are present.
  const times = history.map((s) => Date.parse(s.created_at)).filter((t) => Number.isFinite(t));
  if (times.length >= 2) {
    const spans = [];
    for (let i = 1; i < times.length; i++) spans.push((times[i] - times[i - 1]) / 86400000);
    const avgGap = spans.reduce((a, b) => a + b, 0) / spans.length;
    if (avgGap > 0) return perSnapshotSlope / avgGap;
  }
  return perSnapshotSlope / 7; // assume weekly cadence (scheduler default)
}
