// Health-cluster intelligence: campaign risk, list-health analysis, and
// health prediction. All pure. Inputs are deterministic (stats + history +
// preflight); outputs separate FACT / INFERENCE / PREDICTION / RECOMMENDATION
// and carry confidence. Never claims guaranteed inbox placement.
//
// Catch-all is POSITIVE / campaign-eligible — never framed as unhealthy.
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
  const safe = safeNum(c.safe);
  const review = safeNum(c.review);
  const remove = safeNum(c.remove);
  const unknown = safeNum(c.unknown);
  const catchAll = safeNum(stats.risk.catch_all);
  const disposable = safeNum(stats.risk.disposable);
  const role = safeNum(stats.risk.role_based);
  const acceptedStatus = safeNum(stats.deliverability?.accepted);

  // Campaign-eligible = Safe classification (includes catch-all KEEP) and/or
  // explicit catch-all count from risk signals / accepted status.
  // After engine change, catch-all maps to classification=safe, so `safe`
  // already includes them. `catchAll` is still reported for messaging.
  const catchAllInSafe = Math.min(catchAll, safe);
  const provenSafe = Math.max(0, safe - catchAllInSafe);
  const acceptedCatchAll = Math.max(catchAll, acceptedStatus);
  const eligible = safe; // KEEP catch-all → safe
  const eligiblePct = round1((eligible / total) * 100);

  // Risk from actual negatives only. Unknown is mild; catch-all is NOT a risk.
  let riskScore = round1(
    (remove / total) * 100 * 0.7 +
    (review / total) * 100 * 0.25 +
    (unknown / total) * 100 * 0.1
  );

  const delta = snapshotDelta(history);
  if (delta && delta.healthDelta < 0) riskScore += Math.min(15, Math.abs(delta.healthDelta) * 1.5);
  riskScore = clampScore(riskScore);

  const riskLevel = riskScore >= 40 ? RISK_LEVEL.HIGH : riskScore >= 18 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;

  const reasoning = [];
  const keyRisks = [];
  reasoning.push(fact(
    `Of ${total} recipients: ${provenSafe} proven safe, ${acceptedCatchAll} accepted/catch-all, ` +
    `${review} review, ${remove} remove, ${unknown} unknown.`
  ));
  reasoning.push(inference(
    `${eligible} recipients (${eligiblePct}%) are campaign-eligible (Safe + Accepted/catch-all).`,
    CONFIDENCE.HIGH
  ));
  if (acceptedCatchAll > 0) {
    reasoning.push(inference(
      `${acceptedCatchAll} catch-all addresses are accepted by healthy mail servers; ` +
      `individual mailbox existence cannot be independently confirmed — not a defect.`,
      CONFIDENCE.HIGH
    ));
  }
  if (unknown > 0) {
    reasoning.push(inference(
      `${unknown} recipients are Unknown (neutral/unconfirmed — not a false-negative failure).`,
      CONFIDENCE.MEDIUM
    ));
  }
  if (remove > 0) keyRisks.push(`${remove} recipients are classified Remove (strong evidence they cannot receive mail).`);
  if (review > 0) keyRisks.push(`${review} recipients need review due to actual risk/conflicting evidence.`);
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
  const recommendedSendCount = eligible;
  if (remove > 0) {
    recommendations.push(recommendation(
      `Remove the ${remove} undeliverable contacts before sending.`,
      CONFIDENCE.HIGH
    ));
  }
  if (riskLevel === RISK_LEVEL.HIGH) {
    recommendations.push(recommendation(
      'Clean definitive removals first; Safe and Accepted (catch-all) remain campaign-eligible.',
      CONFIDENCE.HIGH
    ));
  } else if (riskLevel === RISK_LEVEL.MEDIUM) {
    recommendations.push(recommendation(
      'Send to Safe + Accepted (catch-all) recipients; optionally re-verify Unknown.',
      CONFIDENCE.MEDIUM
    ));
  } else {
    recommendations.push(recommendation(
      'Safe and Accepted (catch-all) recipients are healthy to include. Keep monitoring after send.',
      CONFIDENCE.MEDIUM
    ));
  }
  if (preflight?.verdict) reasoning.push(fact(`Deterministic preflight verdict: ${preflight.verdict}`));

  const why = `Campaign risk is ${riskLevel}. ${eligible} recipients are campaign-eligible ` +
    `(${provenSafe} proven safe + catch-all/accepted included in Safe/Accepted). ` +
    (acceptedCatchAll > 0
      ? `${acceptedCatchAll} catch-all addresses reflect healthy mail infrastructure with an individual-verification limitation. `
      : '') +
    (remove > 0 ? `${remove} remove and ${review} review are the main risk drivers. ` : '') +
    (unknown > 0 ? `${unknown} unknown are neutral/unconfirmed, not false negatives. ` : '') +
    'Inbox placement is never guaranteed; this reflects list quality only.';

  return {
    available: true,
    riskLevel,
    riskScore,
    safeRecipients: provenSafe,
    acceptedRecipients: acceptedCatchAll,
    reviewRecipients: review,
    removeRecipients: remove,
    unknownRecipients: unknown,
    recommendedSendCount,
    safePct: eligiblePct,
    eligiblePct,
    problemPct: round1(((remove + review) / total) * 100),
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
  const catchAll = safeNum(stats.risk?.catch_all ?? summary.breakdown?.catchAll);

  let trend = 'STABLE';
  if (delta) {
    if (delta.healthDelta <= -1) trend = 'DECLINING';
    else if (delta.healthDelta >= 1) trend = 'IMPROVING';
  }

  const majorContributors = [];
  const positiveSignals = [];
  const negativeSignals = [];

  for (const [label, key] of [['Deliverability', 'deliverability'], ['Data quality', 'dataQuality'], ['Risk', 'risk'], ['Domain health', 'domainHealth']]) {
    const v = safeNum(m[key]);
    if (v >= 90) positiveSignals.push(`${label} is strong (${v}).`);
    else if (v < 75) { majorContributors.push({ metric: label, value: v, gap: round1(100 - v) }); negativeSignals.push(`${label} is low (${v}).`); }
  }
  majorContributors.sort((a, b) => b.gap - a.gap);

  if (catchAll > 0) {
    positiveSignals.push(
      `${catchAll} catch-all addresses are accepted (healthy mail infrastructure; mailbox not individually proven).`
    );
  }

  if (delta) {
    for (const [k, label] of [['remove', 'Remove'], ['unknown', 'Unknown'], ['review', 'Review'], ['safe', 'Safe']]) {
      const d = safeNum(delta.counts[k]);
      if (d > 0 && k === 'remove') negativeSignals.push(`${label} contacts increased by ${d} since the last check.`);
      if (d > 0 && k === 'review') negativeSignals.push(`${label} contacts increased by ${d} since the last check.`);
      if (d > 0 && k === 'safe') positiveSignals.push(`Safe/accepted contacts increased by ${d} since the last check.`);
    }
  }

  const parts = [`List health is ${health}/100 (${trend.toLowerCase()}).`];
  if (catchAll > 0) {
    parts.push(`Catch-all contacts (${catchAll}) do not reduce health — they are accepted/positive infrastructure signals.`);
  }
  if (delta && trend === 'DECLINING') {
    const drivers = ['remove', 'review'].map((k) => ({ k, d: safeNum(delta.counts[k]) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    if (drivers.length) parts.push(`The decline is driven mainly by more ${drivers.map((d) => `${d.k} (+${d.d})`).join(', ')}.`);
  } else if (trend === 'IMPROVING') {
    parts.push('Recent changes moved the list in a healthier direction.');
  } else if (!delta) {
    parts.push('Only one verification snapshot exists, so no trend is available yet.');
  }

  const recommendations = [];
  if (safeNum(stats.classification.remove) > 0) {
    recommendations.push(recommendation(`Remove the ${stats.classification.remove} undeliverable contacts to lift data quality.`, CONFIDENCE.HIGH));
  }
  if (safeNum(stats.classification.unknown) > 0) {
    recommendations.push(recommendation(
      `Optionally re-verify the ${stats.classification.unknown} unknown contacts where live SMTP is available (unknown is neutral, not a failure).`,
      CONFIDENCE.MEDIUM
    ));
  }
  if (recommendations.length === 0) {
    recommendations.push(recommendation('No cleanup needed right now; keep monitoring on your schedule.', CONFIDENCE.MEDIUM));
  }

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
// is always framed as a range, never a fact.
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

  const perDaySlope = estimatePerDaySlope(h, fit.slope);
  const project = (days) => clampScore(currentScore + perDaySlope * days);

  const p30 = project(30), p60 = project(60), p90 = project(90);
  const trend = fit.slope < -0.5 ? 'DECLINING' : fit.slope > 0.5 ? 'IMPROVING' : 'STABLE';
  const confidence = h.length >= 5 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;

  const band = confidence === CONFIDENCE.LOW ? 4 : 2.5;
  const range = (v) => `${clampScore(v - band)}–${clampScore(v + band)}`;

  const drivers = [];
  if (trend === 'DECLINING') drivers.push('the recent downward trend in health snapshots');
  if (trend === 'IMPROVING') drivers.push('the recent upward trend in health snapshots');
  if (trend === 'STABLE') drivers.push('a broadly flat recent trend');

  let warning = '';
  if (trend === 'DECLINING' && p90 < 60) {
    warning = 'Projected health falls below 60 within 90 days if the trend continues; schedule re-verification and cleaning.';
  }

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
  const times = history.map((s) => Date.parse(s.created_at)).filter((t) => Number.isFinite(t));
  if (times.length >= 2) {
    const spans = [];
    for (let i = 1; i < times.length; i++) spans.push((times[i] - times[i - 1]) / 86400000);
    const avgGap = spans.reduce((a, b) => a + b, 0) / spans.length;
    if (avgGap > 0) return perSnapshotSlope / avgGap;
  }
  return perSnapshotSlope / 7;
}
