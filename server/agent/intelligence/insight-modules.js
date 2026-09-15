// Insight-cluster intelligence: business insights, benchmark/confidence
// calibration, and the investigation orchestrator. Pure. The investigator
// composes other modules into a root-cause narrative but asserts no cause the
// evidence doesn't support.
import {
  CONFIDENCE, INSUFFICIENT,
  fact, inference, recommendation, round1, pct, safeNum,
} from './common.js';
import { campaignRisk } from './health-modules.js';
import { detectAnomalies, detectIncident } from './detection-modules.js';

// ---- MODULE 15: Business Insights -----------------------------------------
// Converts technical stats into business-facing summary. Avoids unsupported
// claims about revenue / open rate / inbox placement / reputation.
export function businessInsights({ stats, summary, domainStats, history }) {
  if (!stats || stats.total === 0) return { available: false, message: INSUFFICIENT, insights: [] };
  const c = stats.classification;
  const needAttention = safeNum(c.review) + safeNum(c.remove) + safeNum(c.unknown);
  const insights = [];

  insights.push(fact(`Your database has ${stats.total} contacts; ${safeNum(c.safe)} are campaign-ready (Safe).`));
  if (needAttention > 0) {
    insights.push(inference(`${needAttention} contacts need review, removal, or re-verification before they should be relied on for sending.`, CONFIDENCE.HIGH));
  }
  if (domainStats && domainStats.domains.length) {
    const worst = domainStats.domains.slice(0, 3).filter((d) => d.problemScore > 0);
    if (worst.length) {
      insights.push(inference(`The largest concentration of problems is within ${worst.length} domain(s): ${worst.map((d) => d.domain).join(', ')}.`, CONFIDENCE.MEDIUM));
    }
  }
  if (summary?.health != null) insights.push(fact(`Overall list health is ${round1(summary.health)}/100.`));

  const recommendations = [];
  if (safeNum(c.remove) > 0) recommendations.push(recommendation(`Clean the ${c.remove} undeliverable contacts before your next campaign to improve list quality. The effect on actual inbox placement cannot be guaranteed.`, CONFIDENCE.MEDIUM));
  if (safeNum(c.unknown) > 0) recommendations.push(recommendation(`Re-verify the ${c.unknown} unconfirmed contacts where live SMTP is available to reduce uncertainty.`, CONFIDENCE.MEDIUM));
  if (recommendations.length === 0) recommendations.push(recommendation('The database looks clean; maintain scheduled re-verification to keep it that way.', CONFIDENCE.MEDIUM));

  return {
    available: true,
    listQuality: safeNum(stats.percentages.safe),
    contactsNeedingAttention: needAttention,
    campaignReady: safeNum(c.safe),
    insights,
    recommendations,
    disclaimer: 'Insights describe list data quality only. No claims are made about revenue, open/conversion rates, inbox placement, or sender-reputation change.',
  };
}

// ---- MODULE 13: Confidence Calibration (benchmark analysis) ---------------
// Analyses a benchmark result (bring-your-own dataset run through the engine).
// It NEVER modifies verdicts — it surfaces where the engine disagrees with
// ground truth so a developer can improve the rules.
export function analyzeBenchmark({ benchmark }) {
  if (!benchmark || !Array.isArray(benchmark.results) || benchmark.results.length === 0) {
    return { available: false, message: 'Insufficient benchmark data. Provide a labelled dataset run (npm run benchmark).' };
  }
  const results = benchmark.results; // [{ email?, expected, predicted }]
  let tp = 0, tn = 0, fp = 0, fn = 0, unknown = 0, agree = 0;
  const disagreementByReason = {};

  for (const r of results) {
    const expected = norm(r.expected);
    const predicted = norm(r.predicted);
    if (predicted === 'unknown') { unknown++; continue; }
    if (expected === predicted) agree++;
    if (expected === 'deliverable' && predicted === 'deliverable') tp++;
    else if (expected === 'undeliverable' && predicted === 'undeliverable') tn++;
    else if (expected === 'undeliverable' && predicted === 'deliverable') fp++;
    else if (expected === 'deliverable' && predicted === 'undeliverable') fn++;
    if (expected !== predicted && predicted !== 'unknown') {
      const reason = r.reason || r.category || 'other';
      disagreementByReason[reason] = (disagreementByReason[reason] || 0) + 1;
    }
  }

  const evaluated = tp + tn + fp + fn;
  const accuracy = evaluated ? round1(((tp + tn) / evaluated) * 100) : 0;
  const precision = (tp + fp) ? round1((tp / (tp + fp)) * 100) : 0;
  const recall = (tp + fn) ? round1((tp / (tp + fn)) * 100) : 0;
  const fpRate = (fp + tn) ? round1((fp / (fp + tn)) * 100) : 0;
  const fnRate = (fn + tp) ? round1((fn / (fn + tp)) * 100) : 0;

  const topDisagreement = Object.entries(disagreementByReason).sort((a, b) => b[1] - a[1])[0];
  const analysis = [];
  analysis.push(fact(`Accuracy ${accuracy}%, precision ${precision}%, recall ${recall}% over ${evaluated} conclusive cases; ${unknown} left unknown.`));
  if (topDisagreement) {
    analysis.push(inference(`Most disagreements with ground truth involve "${topDisagreement[0]}" (${topDisagreement[1]} case(s)).`, CONFIDENCE.MEDIUM));
  }

  return {
    available: true,
    metrics: {
      accuracy, precision, recall,
      falsePositiveRate: fpRate, falseNegativeRate: fnRate,
      unknownRate: pct(unknown, results.length),
      agreementRate: pct(agree, results.length),
      counts: { tp, tn, fp, fn, unknown, total: results.length },
    },
    disagreementByReason,
    analysis,
    note: 'AI does not change verification verdicts. This analysis is input for developer-led rule improvement only.',
  };
}

// ---- MODULE 10: Investigation Orchestrator --------------------------------
// Composes stats + anomaly + incident + domain data into a structured
// root-cause analysis for questions like "why are so many emails unknown?".
export function investigate({ question, stats, history, capability, domainStats }) {
  if (!stats || stats.total === 0) {
    return { available: false, finding: INSUFFICIENT, evidence: [], possibleCauses: [], confidence: CONFIDENCE.LOW, recommendedAction: '' };
  }
  const anomalies = detectAnomalies({ history });
  const incident = detectIncident({ stats, capability });

  const evidence = [];
  const possibleCauses = [];
  let finding = '';
  let confidence = CONFIDENCE.LOW;
  let recommendedAction = '';

  // Anomaly evidence.
  if (anomalies.available && anomalies.detected) {
    for (const a of anomalies.anomalies) evidence.push(a.statement);
    const worst = anomalies.anomalies.find((a) => a.metric === 'unknown') || anomalies.anomalies[0];
    finding = worst.statement.text;
  } else if (anomalies.available) {
    finding = 'No sudden anomaly between the last two verifications.';
  } else {
    finding = anomalies.message;
  }

  // Incident reasoning drives the cause hypothesis.
  if (incident.available) {
    for (const e of incident.evidence) evidence.push(e);
    if (incident.incident && incident.category === 'verification-infrastructure') {
      possibleCauses.push('Verification infrastructure issue (SMTP probe path / worker), not genuine list deterioration.');
      confidence = incident.confidence;
      recommendedAction = incident.recommendations[0]?.text || 'Check SMTP connectivity before interpreting results as list deterioration.';
    } else {
      possibleCauses.push('Genuine change in the addresses (e.g. catch-all/greylisting or list ageing).');
      confidence = CONFIDENCE.LOW;
      recommendedAction = incident.recommendations[0]?.text || 'Investigate at the domain level.';
    }
  }

  // Domain concentration adds supporting evidence.
  if (domainStats && domainStats.domains.length) {
    const concentrated = domainStats.domains.slice(0, 3).filter((d) => d.problemScore > 0);
    if (concentrated.length) {
      evidence.push(inference(`Problems concentrate in ${concentrated.length} domain(s): ${concentrated.map((d) => d.domain).join(', ')}.`, CONFIDENCE.MEDIUM));
    }
  }

  return {
    available: true,
    question: question || null,
    finding,
    evidence,
    possibleCauses,
    confidence,
    recommendedAction,
    note: 'Causes are hypotheses ranked by evidence; the engine remains the source of truth for individual verdicts.',
  };
}

function norm(v) {
  const s = String(v || '').toLowerCase();
  if (['deliverable', 'valid', 'safe', 'true', 'ok'].includes(s)) return 'deliverable';
  if (['undeliverable', 'invalid', 'remove', 'false', 'bad'].includes(s)) return 'undeliverable';
  if (['unknown', 'risky', 'catch-all', 'catchall', 'review'].includes(s)) return s === 'unknown' ? 'unknown' : s;
  return s || 'unknown';
}
