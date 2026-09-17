// Detection-cluster intelligence: anomaly detection, incident detection, and
// domain intelligence. Pure. These flag unusual change and try to separate
// "the list got worse" from "our verification infrastructure had a problem" —
// but never assert a cause the evidence doesn't support.
import {
  CONFIDENCE, INSUFFICIENT,
  fact, inference, recommendation,
  round1, pct, safeNum,
} from './common.js';
import { snapshotDelta } from './statistics.js';

// Percentage-point jump (in a bucket's share of the list) that counts as
// anomalous between two consecutive snapshots.
const ANOMALY_PP = 15;

// ---- MODULE 4: Anomaly Detection ------------------------------------------
// Compares the two most recent snapshots for sudden shifts in the mix.
export function detectAnomalies({ history }) {
  const delta = snapshotDelta(history);
  if (!delta) {
    return { available: false, message: 'Insufficient history: at least two verification snapshots are required to detect anomalies.', anomalies: [] };
  }
  const prevTotal = sumCounts(delta.previous.counts);
  const curTotal = sumCounts(delta.current.counts);
  const anomalies = [];

  for (const key of ['unknown', 'remove', 'review']) {
    const prevPct = pct(safeNum(delta.previous.counts[key]), prevTotal);
    const curPct = pct(safeNum(delta.current.counts[key]), curTotal);
    const jump = round1(curPct - prevPct);
    if (jump >= ANOMALY_PP) {
      const ratio = prevPct > 0 ? round1(curPct / prevPct) : null;
      anomalies.push({
        metric: key,
        previousPct: prevPct,
        currentPct: curPct,
        deltaPct: jump,
        ratio,
        severity: jump >= 30 ? 'HIGH' : 'MEDIUM',
        statement: fact(`${cap(key)} results rose from ${prevPct}% to ${curPct}%${ratio ? ` (~${ratio}x)` : ''} between the last two verifications.`),
      });
    }
  }

  // Health swing itself can be anomalous.
  if (Math.abs(delta.healthDelta) >= 8) {
    anomalies.push({
      metric: 'health',
      deltaPct: delta.healthDelta,
      severity: Math.abs(delta.healthDelta) >= 15 ? 'HIGH' : 'MEDIUM',
      statement: fact(`List health changed by ${delta.healthDelta} points between the last two verifications.`),
    });
  }

  return {
    available: true,
    anomalies,
    detected: anomalies.length > 0,
    message: anomalies.length ? `${anomalies.length} anomaly signal(s) detected.` : 'No anomalies detected between the last two snapshots.',
  };
}

// ---- MODULE 5 / 14: Incident Detection ------------------------------------
// Distinguishes an infrastructure issue from genuine list deterioration using
// SMTP-source distribution and verification capability. Requires evidence
// before naming a cause; otherwise it reports uncertainty.
export function detectIncident({ stats, capability }) {
  if (!stats || stats.total === 0) {
    return { available: false, message: INSUFFICIENT, incident: false };
  }
  const unknownPct = stats.percentages.unknown;
  const src = stats.smtpSource || {};
  const smtpProbed = safeNum(src['local-smtp']) + safeNum(src['smtp-worker']);
  const smtpMissing = safeNum(src.none) + safeNum(src.unrecorded);
  const smtpMissingPct = pct(smtpMissing, stats.total);

  const evidence = [];
  const recommendations = [];
  let incident = false;
  let severity = 'LOW';
  let category = 'none';
  let confidence = CONFIDENCE.LOW;

  // Signal 1: verification capability itself is degraded/absent.
  const liveSmtpDown = capability && capability.liveSmtp === false && capability.smtpSource === 'none';

  // Signal 2: a large share of contacts have unknown deliverability AND their
  // SMTP evidence is missing -> points at the probe path, not the addresses.
  if (unknownPct >= 30 && smtpMissingPct >= 30) {
    incident = true; severity = unknownPct >= 60 ? 'HIGH' : 'MEDIUM'; category = 'verification-infrastructure';
    confidence = CONFIDENCE.MEDIUM;
    evidence.push(fact(`${unknownPct}% of contacts are Unknown and ${smtpMissingPct}% have no recorded SMTP probe result.`));
    evidence.push(inference('The unknowns coincide with missing SMTP evidence, which points to the verification path (outbound port 25 / worker) rather than the addresses themselves.', CONFIDENCE.MEDIUM));
    recommendations.push(recommendation('Check SMTP connectivity (local port 25 or the SMTP worker health) before treating these results as list deterioration. Re-verify once the probe path is healthy.', CONFIDENCE.HIGH));
  } else if (liveSmtpDown && unknownPct >= 20) {
    incident = true; severity = 'MEDIUM'; category = 'verification-infrastructure'; confidence = CONFIDENCE.MEDIUM;
    evidence.push(fact(`Live SMTP verification is unavailable in this environment (${capability.smtpDetail || 'no probe'}), and ${unknownPct}% of contacts are Unknown.`));
    recommendations.push(recommendation('Deploy or restore the SMTP worker (or run where outbound port 25 is open) to confirm mailboxes; the Unknowns are unconfirmed, not undeliverable.', CONFIDENCE.HIGH));
  } else if (unknownPct >= 30) {
    // High unknowns but SMTP evidence exists -> cannot blame infrastructure.
    evidence.push(fact(`${unknownPct}% of contacts are Unknown, but SMTP was probed for ${pct(smtpProbed, stats.total)}% of them.`));
    evidence.push(inference('Because SMTP evidence is present, this is more likely genuine uncertainty (e.g. catch-all/greylisting) than an infrastructure outage.', CONFIDENCE.LOW));
    recommendations.push(recommendation('Investigate at the domain level (catch-all/greylisting) rather than assuming an outage.', CONFIDENCE.MEDIUM));
  } else {
    evidence.push(fact(`Unknown rate is ${unknownPct}% — within a normal range.`));
  }

  return {
    available: true,
    incident,
    severity,
    category,
    confidence,
    evidence,
    recommendations,
    metrics: { unknownPct, smtpMissingPct, smtpProbedPct: pct(smtpProbed, stats.total) },
  };
}

// ---- MODULE 6: Domain Intelligence ----------------------------------------
// Turns per-domain stats into ranked problem summaries with explanations.
export function domainIntelligence({ domainStats, limit = 10 }) {
  if (!domainStats || domainStats.domainCount === 0) {
    return { available: false, message: INSUFFICIENT, domains: [] };
  }
  const top = domainStats.domains.slice(0, limit).map((d) => {
    const p = d.percentages;
    const problems = [];
    const notes = [];
    if (p.undeliverable > 0) problems.push(`${p.undeliverable}% undeliverable`);
    if (p.disposable > 0) problems.push(`${p.disposable}% disposable`);
    if (p.unknown > 0) problems.push(`${p.unknown}% unknown`);
    // Catch-all is a characteristic of healthy accepting domains, not a defect.
    if (p.catchAll > 0) notes.push(`${p.catchAll}% catch-all (healthy mail path, mailbox unconfirmed)`);
    const summary = problems.length
      ? `${d.domain}: ${d.total} contacts, ${p.deliverable}% deliverable, issues — ${problems.join(', ')}.`
        + (notes.length ? ` Notes — ${notes.join(', ')}.` : '')
      : notes.length
        ? `${d.domain}: ${d.total} contacts, healthy catch-all domain — ${notes.join(', ')}.`
        : `${d.domain}: ${d.total} contacts, ${p.deliverable}% deliverable, no material issues.`;
    let action = 'Keep monitoring.';
    if (p.undeliverable >= 30 || p.disposable >= 20) action = 'Prioritise cleaning: remove undeliverable/disposable contacts on this domain.';
    else if (p.unknown >= 30) action = 'Re-verify: many contacts on this domain are unconfirmed.';
    else if (p.catchAll >= 40) action = 'Healthy catch-all domain: fine to keep known contacts; confirm before large cold sends.';
    return { domain: d.domain, total: d.total, percentages: p, problemScore: d.problemScore, summary, recommendedAction: action };
  });
  return { available: true, domainCount: domainStats.domainCount, domains: top };
}

function sumCounts(counts) {
  return ['safe', 'review', 'remove', 'unknown'].reduce((s, k) => s + safeNum(counts?.[k]), 0);
}
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
