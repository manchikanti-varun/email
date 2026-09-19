// List Diagnosis — AI interpretation layer over the deterministic list-health
// report. PURE (no I/O): it builds the minimized LLM input, holds the system
// prompt, validates the model's structured JSON, and provides a deterministic
// FALLBACK diagnosis so the platform works with AI unavailable.
//
// The AI NEVER verifies, NEVER decides deliverability, NEVER overrides a
// verdict, and NEVER invents metrics. It only explains the supplied evidence.
import { maskEmail } from '../guardrails.js';
import { round1 } from './common.js';

// ---- System prompt --------------------------------------------------------
export const DIAGNOSIS_SYSTEM_PROMPT = [
  'You are analyzing an email list using verification evidence produced by MailHealth.',
  '',
  'You MUST:',
  '- explain the observed patterns in the supplied evidence',
  '- distinguish facts from interpretation',
  '- use ONLY the supplied metrics; never invent numbers, domains, or SMTP responses',
  '- never claim an email is deliverable unless the supplied evidence says so',
  '- never override MailHealth\'s backend classifications',
  '- never recommend sending to addresses classified as undeliverable',
  '- treat UNKNOWN as unconfirmed/neutral (a timeout or transport limitation), NOT as invalid',
  '- treat ACCEPT_ALL as a healthy-infrastructure signal where the exact mailbox cannot be independently confirmed, NOT as simply deliverable and NOT as a failure',
  '- use PRECISE terminology. "deliverable" means confirmed mailbox-level SMTP evidence ONLY. Never call the list\'s deliverability "high" when the deliverable percentage is low. Prefer phrasing like "X% received positive mailbox-level SMTP evidence", "Y% could not be conclusively verified", "Z% are on catch-all domains where mailbox existence cannot be independently confirmed".',
  '- never sum deliverable + accept-all + unknown into a single "deliverability" figure',
  '- clearly state when evidence is insufficient',
  '- give practical, prioritized cleanup recommendations grounded in the evidence',
  '',
  'Respond ONLY with a single valid JSON object matching this schema:',
  '{',
  '  "summary": string,',
  '  "keyIssues": [ { "issue": string, "severity": "high"|"medium"|"low", "evidence": string, "impact": string } ],',
  '  "recommendations": [ { "action": string, "priority": "high"|"medium"|"low", "reason": string } ],',
  '  "observations": [ string ]',
  '}',
  'Do not include markdown, code fences, or any text outside the JSON object.',
].join('\n');

// ---- Build the minimized AI input (data minimization) ---------------------
// Sends AGGREGATES + masked representative examples only. No raw list, no
// secrets. Representative example addresses are masked (j***@domain).
export function buildDiagnosisInput({ report, contacts = [], list = null }) {
  const m = report.metrics;
  const representativeExamples = pickRepresentativeExamples(contacts);
  return {
    list: list ? { name: safeName(list.name), total: list.total } : { total: m.total },
    healthScore: report.healthScore,
    healthLevel: report.healthLevel,
    scoreComponents: report.scoreModel.components.filter((c) => c.penalty > 0),
    listMetrics: {
      total: m.total,
      deliverable: m.deliverable,
      undeliverable: m.undeliverable,
      unknown: m.unknown,
      acceptAll: m.acceptAll,
      percentages: m.percentages,
      additionalSignals: m.additionalSignals,
    },
    domainMetrics: (report.domains || []).slice(0, 8).map((d) => ({
      domain: d.domain,
      total: d.total,
      undeliverable: d.undeliverable,
      unknown: d.unknown,
      acceptAll: d.accepted,
      problemRate: d.problemRate,
    })),
    providerMetrics: report.providers || [],
    riskSignals: (report.riskSignals || []).map((r) => ({
      code: r.code, severity: r.severity, count: r.count, percentage: r.percentage,
    })),
    representativeExamples,
  };
}

// Pick up to a few masked examples per major bucket so the model has concrete
// (but privacy-minimized) references. Never sends full addresses.
function pickRepresentativeExamples(contacts) {
  const byBucket = { undeliverable: [], acceptAll: [], unknown: [], deliverable: [] };
  for (const c of contacts || []) {
    const d = c.deliverability || c.status || 'unknown';
    const bucket = d === 'accepted' ? 'acceptAll' : (byBucket[d] ? d : null);
    if (bucket && byBucket[bucket].length < 3) {
      byBucket[bucket].push({ email: maskEmail(c.email), classification: c.classification, deliverability: d });
    }
  }
  return [...byBucket.undeliverable, ...byBucket.acceptAll, ...byBucket.unknown, ...byBucket.deliverable];
}

function safeName(name) {
  return String(name || 'list').replace(/[\r\n\x00-\x1f]/g, '').slice(0, 120);
}

// ---- Validate the AI response ---------------------------------------------
const SEVERITIES = new Set(['high', 'medium', 'low']);
function normSeverity(v, dflt = 'medium') {
  const s = String(v || '').toLowerCase();
  return SEVERITIES.has(s) ? s : dflt;
}

/**
 * Validate + normalize a model JSON diagnosis. Returns null if it is not a
 * usable object (so the caller falls back). Coerces/limits fields defensively
 * and strips anything not in the schema (no arbitrary UI markup passthrough).
 */
export function validateDiagnosis(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const summary = typeof json.summary === 'string' ? json.summary.trim() : '';
  if (!summary) return null;

  const keyIssues = Array.isArray(json.keyIssues)
    ? json.keyIssues.slice(0, 10).map((k) => ({
      issue: str(k?.issue, 300),
      severity: normSeverity(k?.severity),
      evidence: str(k?.evidence, 400),
      impact: str(k?.impact, 300),
    })).filter((k) => k.issue)
    : [];

  const recommendations = Array.isArray(json.recommendations)
    ? json.recommendations.slice(0, 10).map((r) => ({
      action: str(r?.action, 300),
      priority: normSeverity(r?.priority),
      reason: str(r?.reason, 400),
    })).filter((r) => r.action)
    : [];

  const observations = Array.isArray(json.observations)
    ? json.observations.slice(0, 10).map((o) => str(o, 400)).filter(Boolean)
    : [];

  return { summary: str(summary, 1500), keyIssues, recommendations, observations };
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// ---- Deterministic fallback diagnosis -------------------------------------
// Used when AI is disabled, unavailable, times out, or returns invalid JSON.
// Built entirely from the deterministic report so the platform is never
// dependent on the LLM for a usable diagnosis.
export function fallbackDiagnosis(report) {
  const m = report.metrics;
  const p = m.percentages;
  const summary = m.total === 0
    ? 'This list has no verified contacts yet, so no health diagnosis is available. Verify the list to generate a report.'
    : `List health is ${report.healthScore}/100 (${report.healthLevel}). `
      + `${p.deliverable}% of addresses received positive mailbox-level SMTP evidence (deliverable). `
      + `${p.unknown}% could not be conclusively verified (unknown). `
      + `${p.acceptAll}% are on catch-all domains, where mailbox existence cannot be independently confirmed. `
      + `${p.undeliverable}% have definitive negative evidence (undeliverable). `
      + (m.undeliverable > 0
        ? `The clearest action is removing the ${m.undeliverable} undeliverable addresses before your next campaign.`
        : 'No definitive undeliverable addresses were found.');

  const keyIssues = (report.riskSignals || [])
    .filter((r) => r.severity === 'high' || (r.severity === 'medium' && r.count > 0))
    .slice(0, 6)
    .map((r) => ({
      issue: r.label,
      severity: r.severity,
      evidence: `${r.count} addresses (${r.percentage}% of the list).`,
      impact: r.detail,
    }));

  const recommendations = (report.recommendations || []).map((r) => ({
    action: r.action, priority: r.priority, reason: r.reason,
  }));

  const observations = [];
  if (report.providers && report.providers.length > 1) {
    const worst = [...report.providers].sort((a, b) => b.percentages.undeliverable - a.percentages.undeliverable)[0];
    if (worst && worst.percentages.undeliverable > 0) {
      observations.push(`The "${worst.provider}" provider family has the highest undeliverable rate (${worst.percentages.undeliverable}%).`);
    }
  }
  if (report.domains && report.domains.length) {
    const worst = report.domains[0];
    if (worst.problemRate > 0) {
      observations.push(`"${worst.domain}" concentrates the most problems (${worst.undeliverable} failed of ${worst.total}).`);
    }
  }
  if (m.acceptAll > 0) {
    observations.push(`${m.acceptAll} catch-all addresses are on domains that accept arbitrary recipients; mailbox existence cannot be independently confirmed, so they are marked for review rather than confirmed deliverable.`);
  }
  if (m.unknown > 0) {
    observations.push(`${m.unknown} unknown results are unconfirmed (not invalid) and can be re-verified later.`);
  }
  const infra = m.additionalSignals && m.additionalSignals.infraUnknown;
  if (infra && infra > 0) {
    observations.push(`${infra} of the unknown results are associated with SMTP transport timeouts or mail servers not completing a handshake, which may reflect verification infrastructure limitations rather than mailbox invalidity.`);
  }

  return { summary, keyIssues, recommendations, observations };
}

// ---- Cost / provenance helper ---------------------------------------------
export function diagnosisMeta({ source, model = null, latencyMs = 0, estimatedCost = 0, error = null }) {
  return {
    source,                       // 'ai' | 'deterministic'
    model: model || (source === 'ai' ? 'unknown' : 'deterministic'),
    latencyMs: round1(latencyMs),
    estimatedCost: estimatedCost || 0,
    ...(error ? { error } : {}),
  };
}
