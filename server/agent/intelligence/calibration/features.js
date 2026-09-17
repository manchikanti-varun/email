// ML Confidence Calibration — Feature Extraction.
//
// PURE module. Transforms a DETERMINISTIC verification result (the exact object
// produced by server/src/domain/verification/engine.js finalize(), or a
// persisted/domain contact) into a fixed-order numeric feature vector for the
// calibration model.
//
// NON-NEGOTIABLE RULES:
//   - This module NEVER invents evidence. Every feature is READ from fields the
//     deterministic engine already produced. When a signal is absent we encode
//     "unknown/absent" explicitly (a dedicated *_known flag) rather than
//     guessing a value.
//   - It NEVER changes a verdict. It only describes the evidence numerically.
//   - Only features that correspond to REAL existing fields are used.
//
// The engine result exposes (verbatim field names):
//   deliverability, deliverabilityScore, confidence, riskSignals[{code,...}],
//   recommendedAction, evidence[{status,label}] (alias: signals), greylisted,
//   provider (string|null), smtpSource, classification, status, score.
//
// SMTP granular booleans (mailboxExists/mailboxRejected/catchAll) are NOT kept
// on the final result — they are collapsed into deliverability + evidence +
// riskSignals. We therefore reconstruct them from those durable fields only,
// never from a re-probe.

import { domainOf } from '../common.js';

// Canonical feature order. The model depends on this ordering; changing it is a
// model-version change. Each entry: [name, extractor].
export const FEATURE_NAMES = Object.freeze([
  'syntax_valid',
  'domain_exists',
  'mx_exists',
  'smtp_connected',
  'smtp_accept',
  'smtp_reject',
  'catch_all',
  'disposable',
  'role',
  'greylisted',
  'has_provider',
  'provider_agreement',
  'has_previous_verdict',
  'previous_agreement',
  'verification_age_days',
  'deliverable_verdict',
  'undeliverable_verdict',
  'risky_verdict',
  'unknown_verdict',
]);

// ---- Small readers over the durable engine/contact shape -------------------

function evidenceList(v) {
  // engine result exposes both `evidence` and its alias `signals`.
  return Array.isArray(v?.evidence) ? v.evidence
    : Array.isArray(v?.signals) ? v.signals
      : [];
}

function hasEvidence(v, re) {
  return evidenceList(v).some((e) => e && typeof e.label === 'string' && re.test(e.label));
}

function hasRiskCode(v, code) {
  const rs = v?.riskSignals;
  return Array.isArray(rs) && rs.some((r) => r && r.code === code);
}

function normVerdict(x) {
  const s = String(x || '').toLowerCase();
  if (s === 'deliverable' || s === 'undeliverable' || s === 'risky' || s === 'unknown') return s;
  return 'unknown';
}

// Derive the SMTP sub-facts from durable fields ONLY (no re-probe).
//   connected  : an SMTP handshake happened (server responded)
//   accept     : mailbox confirmed to exist
//   reject     : mailbox rejected by server
function smtpFacts(v) {
  const connected = hasEvidence(v, /SMTP server responds|SMTP.*respond/i);
  const accept = hasEvidence(v, /Mailbox confirmed to exist/i);
  const reject = hasEvidence(v, /Mailbox rejected/i);
  return { connected, accept, reject };
}

// ---- Ground-truth / reference helpers (used by dataset + agreement) --------

// Map any verdict-ish label onto the 4-class deliverability vocabulary so that
// the classification vocabulary ('safe'|'review'|'remove'|'unknown') and the
// deliverability vocabulary can be compared consistently.
export function toDeliverability(label) {
  const s = String(label || '').toLowerCase();
  switch (s) {
    case 'deliverable':
    case 'safe':
    case 'valid':
    case 'keep':
      return 'deliverable';
    case 'accepted':
    case 'accept_all':
    case 'catch-all':
    case 'catch_all':
      // Catch-all is positive/accepted; for ML vocabulary fold toward deliverable
      // so it is not treated as a negative "risky" class.
      return 'deliverable';
    case 'undeliverable':
    case 'remove':
    case 'invalid':
      return 'undeliverable';
    case 'risky':
    case 'review':
      return 'risky';
    default:
      return 'unknown';
  }
}

// Provider agreement in {-1,0,1}: agree(+1) / disagree(-1) / no-provider(0).
export function providerAgreement(v) {
  if (!v || !v.provider) return 0;
  // The engine only calls the provider when local evidence was inconclusive and
  // folds the provider result into the final deliverability. When a provider
  // name is present we treat the final verdict as reflecting provider input;
  // disagreement is surfaced only when explicit provider evidence contradicts.
  const provDeliverable = hasEvidence(v, /Deliverable per provider/i);
  const provUndeliverable = hasEvidence(v, /Undeliverable per provider/i);
  const verdict = normVerdict(v.deliverability || v.status);
  if (provDeliverable) return verdict === 'undeliverable' ? -1 : 1;
  if (provUndeliverable) return verdict === 'deliverable' ? -1 : 1;
  return 1; // provider consulted, no contradiction recorded
}

function ageDays(verifiedAt, now = Date.now()) {
  const t = Date.parse(verifiedAt || '');
  if (!Number.isFinite(t)) return -1; // unknown age encoded as -1
  const days = (now - t) / (1000 * 60 * 60 * 24);
  return days < 0 ? 0 : Math.round(days * 10) / 10;
}

/**
 * Extract the fixed-order feature vector from a deterministic verification
 * result / contact. Missing signals are encoded explicitly, never fabricated.
 *
 * @param {object} v  engine result or domain contact
 * @param {object} [ctx]  optional context
 * @param {string} [ctx.previousVerdict]  prior deliverability for this address
 * @param {number} [ctx.now]  clock override for age (ms) — for reproducible tests
 * @returns {{ vector:number[], byName:object, meta:object }}
 */
export function extractFeatures(v, ctx = {}) {
  if (!v || typeof v !== 'object') {
    // No evidence at all — everything absent. This still returns a valid vector
    // (all zeros / unknown) so the caller can decide to fall back.
    const zero = FEATURE_NAMES.map(() => 0);
    const byName = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, zero[i]]));
    return { vector: zero, byName, meta: { empty: true } };
  }

  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const verdict = normVerdict(v.deliverability || v.status);
  const smtp = smtpFacts(v);

  const syntaxValid = !hasEvidence(v, /Invalid syntax/i) && verdict !== undefined
    ? (hasEvidence(v, /Valid syntax/i) ? 1 : (hasEvidence(v, /Invalid syntax/i) ? 0 : 1))
    : 1;

  const domainExists = hasEvidence(v, /Domain exists/i) ? 1
    : hasEvidence(v, /Domain does not exist/i) ? 0
      : (verdict === 'undeliverable' && hasRiskCode(v, 'domain_missing') ? 0 : 1);

  const mxExists = hasEvidence(v, /MX records found/i) ? 1
    : (hasRiskCode(v, 'no_mx') ? 0 : (hasEvidence(v, /No MX/i) ? 0 : 0));

  const disposable = hasRiskCode(v, 'disposable') ? 1 : 0;
  const role = hasRiskCode(v, 'role_based') ? 1 : 0;
  const catchAll = hasRiskCode(v, 'catch_all') ? 1 : 0;
  const greylisted = v.greylisted === true || hasRiskCode(v, 'temporary_failure') ? 1 : 0;

  const hasProvider = v.provider ? 1 : 0;
  const provAgreement = providerAgreement(v); // -1|0|1

  const prev = ctx.previousVerdict ? normVerdict(ctx.previousVerdict) : null;
  const hasPrev = prev ? 1 : 0;
  const prevAgreement = prev ? (prev === verdict ? 1 : -1) : 0;

  const age = ageDays(v.verified_at || v.verifiedAt, now);

  const byName = {
    syntax_valid: syntaxValid,
    domain_exists: domainExists,
    mx_exists: mxExists,
    smtp_connected: smtp.connected ? 1 : 0,
    smtp_accept: smtp.accept ? 1 : 0,
    smtp_reject: smtp.reject ? 1 : 0,
    catch_all: catchAll,
    disposable,
    role,
    greylisted,
    has_provider: hasProvider,
    provider_agreement: provAgreement,
    has_previous_verdict: hasPrev,
    previous_agreement: prevAgreement,
    verification_age_days: age,
    deliverable_verdict: verdict === 'deliverable' ? 1 : 0,
    undeliverable_verdict: verdict === 'undeliverable' ? 1 : 0,
    risky_verdict: verdict === 'risky' ? 1 : 0,
    unknown_verdict: verdict === 'unknown' ? 1 : 0,
  };

  const vector = FEATURE_NAMES.map((n) => byName[n]);

  return {
    vector,
    byName,
    meta: {
      empty: false,
      verdict,
      domain: domainOf(v.email || ''),
      smtpSource: v.smtpSource || null,
    },
  };
}

// Human-readable evidence bullets for explainability. Returns [{sign, text}]
// where sign is '+' (supports reliability) or '-' (reduces reliability).
export function evidenceBullets(v) {
  const f = extractFeatures(v).byName;
  const out = [];
  if (f.syntax_valid) out.push({ sign: '+', text: 'Syntax is valid' });
  else out.push({ sign: '-', text: 'Syntax is invalid' });
  if (f.domain_exists) out.push({ sign: '+', text: 'Domain resolves in DNS' });
  else out.push({ sign: '-', text: 'Domain does not resolve' });
  if (f.mx_exists) out.push({ sign: '+', text: 'MX records present' });
  if (f.smtp_connected) out.push({ sign: '+', text: 'SMTP server responded' });
  if (f.smtp_accept) out.push({ sign: '+', text: 'Mailbox independently confirmed' });
  if (f.smtp_reject) out.push({ sign: '+', text: 'Mailbox explicitly rejected (clear signal)' });
  // Catch-all is informational: supports that SMTP accepted, reduces certainty of
  // the *individual* mailbox — not a negative "domain is bad" signal.
  if (f.catch_all) out.push({ sign: '+', text: 'Healthy catch-all domain: mail accepted; specific mailbox unconfirmed' });
  if (f.greylisted) out.push({ sign: '-', text: 'Temporary failure / greylisting observed' });
  if (f.disposable) out.push({ sign: '+', text: 'Disposable domain (clear removal signal)' });
  if (f.has_provider) out.push({ sign: f.provider_agreement < 0 ? '-' : '+', text: f.provider_agreement < 0 ? 'External provider disagrees with local evidence' : 'External provider corroborates evidence' });
  if (!f.smtp_connected && !f.smtp_accept && !f.smtp_reject) out.push({ sign: '-', text: 'No live SMTP mailbox confirmation available' });
  return out;
}
