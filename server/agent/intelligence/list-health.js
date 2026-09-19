// List Health — deterministic aggregation + explainable health score.
//
// PURE module (no I/O, no LLM). It composes the existing deterministic
// statistics (listStatistics / domainStatistics) into a single, explainable
// list-health report:
//   - list-level metrics (counts + percentages) — FACTS from the engine
//   - provider/domain-family breakdown (extensible classification)
//   - an EXPLAINABLE health score (documented weights, deterministic)
//   - a human-readable health level (product labels, configurable thresholds)
//   - deterministic risk signals + recommended actions
//
// It NEVER performs verification, NEVER changes a verdict, and NEVER invents
// values. The AI layer (list-diagnosis.js) only INTERPRETS this report.
//
// -----------------------------------------------------------------------------
// HEALTH SCORE FORMULA (documented, deterministic, testable)
// -----------------------------------------------------------------------------
//   healthScore = clamp0..100( 100 - weightedRisk )
//
//   weightedRisk = Σ ( signalPercentage × weight )   over the risk signals below
//
// where each signalPercentage is the share of the whole list (0..100) and the
// weights encode MailHealth's existing product semantics:
//
//   undeliverable   × 1.00   definitive negative SMTP evidence (worst)
//   syntaxInvalid   × 1.00   cannot receive mail
//   domainInvalid   × 1.00   domain has no DNS / cannot receive mail
//   disposable      × 0.90   throwaway mailboxes; harmful to send to
//   noMx            × 0.60   no dedicated mail servers (less reliable)
//   unknown         × 0.15   NEUTRAL/unconfirmed — small confidence penalty only
//   roleBased       × 0.10   a characteristic, not a defect (tiny nudge)
//   acceptAll       × 0.10   positive infra signal; only a small confidence cost
//
// Rationale (matches existing engine semantics):
//   * Only definitive negatives are penalised heavily.
//   * "Lack of evidence is never negative evidence": UNKNOWN barely moves the
//     score (0.15) and is framed as a confidence cost, not a failure.
//   * ACCEPT_ALL is a healthy-infrastructure signal, so it costs almost nothing
//     (0.10) and is NEVER treated as undeliverable.
//   * The weighted risk is capped so a fully-bad list floors at 0, not below.
//
// The weights live in HEALTH_WEIGHTS and can be tuned without touching logic.
// The score components are returned so the UI can show exactly why the score is
// what it is.
import { pct, round1, clampScore } from './common.js';
import { listStatistics, domainStatistics } from './statistics.js';

// ---- Configurable scoring weights (share-of-list, 0..1) --------------------
export const HEALTH_WEIGHTS = Object.freeze({
  undeliverable: 1.0,
  syntaxInvalid: 1.0,
  domainInvalid: 1.0,
  disposable: 0.9,
  noMx: 0.6,
  unknown: 0.15,
  roleBased: 0.1,
  acceptAll: 0.1,
});

// ---- Health-level thresholds + labels (product labels, configurable) -------
export const HEALTH_LEVELS = Object.freeze([
  { min: 90, level: 'Excellent' },
  { min: 75, level: 'Good' },
  { min: 60, level: 'Needs Attention' },
  { min: 40, level: 'Poor' },
  { min: 0, level: 'Critical' },
]);

export function healthLevel(score) {
  const s = clampScore(score);
  for (const t of HEALTH_LEVELS) if (s >= t.min) return t.level;
  return 'Critical';
}

// ---- Provider / domain-family classification (extensible) ------------------
// A small, extensible mapping. Anything not matched is 'corporate/other'. This
// is intentionally minimal — it is a display grouping, NOT a verification
// input, and it never changes any verdict.
const PROVIDER_DOMAINS = Object.freeze({
  gmail: ['gmail.com', 'googlemail.com'],
  outlook: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.co.uk'],
  yahoo: ['yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com'],
  icloud: ['icloud.com', 'me.com', 'mac.com'],
  aol: ['aol.com'],
  proton: ['proton.me', 'protonmail.com', 'pm.me'],
  zoho: ['zoho.com', 'zohomail.com'],
});

/** Classify a domain into a provider family label. Extensible via PROVIDER_DOMAINS. */
export function classifyProvider(domain, { disposable = false } = {}) {
  const d = String(domain || '').toLowerCase();
  if (!d) return 'unknown';
  if (disposable) return 'disposable';
  for (const [family, domains] of Object.entries(PROVIDER_DOMAINS)) {
    if (domains.includes(d)) return family;
  }
  return 'corporate/other';
}

// ---- Additional signals (counts) not directly in listStatistics ------------
// syntaxInvalid / domainInvalid are derivable from contact evidence; we count
// them defensively from riskSignals + evidence labels the engine already emits.
function countAdditionalSignals(contacts) {
  let syntaxInvalid = 0;
  let domainInvalid = 0;
  for (const c of contacts || []) {
    const rs = Array.isArray(c.riskSignals) ? c.riskSignals : [];
    const sigs = Array.isArray(c.signals) ? c.signals : [];
    const hasCode = (code) => rs.some((r) => r && r.code === code);
    // domain_missing risk => invalid domain; finalReason also carries this.
    if (hasCode('domain_missing') || c.finalReason === 'domain_missing') domainInvalid++;
    // Invalid syntax is a fail signal with an "Invalid syntax" evidence label
    // OR a reserved/documentation domain (also cannot receive mail).
    const syntaxFail = sigs.some((s) => s && s.status === 'fail' && /invalid syntax/i.test(s.label || ''));
    if (syntaxFail || c.finalReason === 'invalid_syntax' || c.finalReason === 'reserved_domain') syntaxInvalid++;
  }
  return { syntaxInvalid, domainInvalid };
}

/**
 * Build the deterministic list-health report.
 * @param {object} p
 * @param {Array<object>} p.contacts  domain contacts (engine output rows)
 * @param {object} [p.summary]        list summary (health.summarize) — optional
 * @param {number} [p.domainLimit]    max domains to include in the breakdown
 * @returns {object} the full deterministic report (source of truth for the AI)
 */
export function buildListHealth({ contacts, summary = null, domainLimit = 10 } = {}) {
  const rows = Array.isArray(contacts) ? contacts : [];
  const stats = listStatistics(rows);
  const total = stats.total;
  const domainStats = domainStatistics(rows, { minContacts: 1 });
  const extra = countAdditionalSignals(rows);

  // ---- List-level metrics (FACTS) -----------------------------------------
  const deliverable = stats.deliverability.deliverable;
  const undeliverable = stats.deliverability.undeliverable;
  const unknownCount = stats.deliverability.unknown;
  const acceptAll = stats.deliverability.accepted; // engine: accepted == ACCEPT_ALL
  const risky = stats.deliverability.risky;

  const metrics = {
    total,
    deliverable,
    undeliverable,
    unknown: unknownCount,
    acceptAll,
    risky,
    percentages: {
      deliverable: pct(deliverable, total),
      undeliverable: pct(undeliverable, total),
      unknown: pct(unknownCount, total),
      acceptAll: pct(acceptAll, total),
      risky: pct(risky, total),
    },
    additionalSignals: {
      disposable: stats.risk.disposable,
      roleBased: stats.risk.role_based,
      catchAll: stats.risk.catch_all,
      noMx: stats.risk.no_mx,
      syntaxInvalid: extra.syntaxInvalid,
      domainInvalid: extra.domainInvalid,
      greylisted: stats.greylisted,
    },
  };

  // ---- Explainable health score -------------------------------------------
  const share = {
    undeliverable: pct(undeliverable, total),
    syntaxInvalid: pct(extra.syntaxInvalid, total),
    domainInvalid: pct(extra.domainInvalid, total),
    disposable: pct(stats.risk.disposable, total),
    noMx: pct(stats.risk.no_mx, total),
    unknown: pct(unknownCount, total),
    roleBased: pct(stats.risk.role_based, total),
    acceptAll: pct(acceptAll, total),
  };
  const components = Object.entries(HEALTH_WEIGHTS).map(([key, weight]) => ({
    signal: key,
    percentage: share[key] ?? 0,
    weight,
    penalty: round1((share[key] ?? 0) * weight),
  }));
  const weightedRisk = round1(components.reduce((sum, c) => sum + c.penalty, 0));
  // Empty list => neutral 100 (nothing bad observed). Fully-bad list floors at 0.
  const score = total === 0 ? 100 : clampScore(100 - weightedRisk);
  const level = healthLevel(score);

  // ---- Provider / domain-family breakdown ---------------------------------
  const providerMap = new Map();
  for (const d of domainStats.domains) {
    const family = classifyProvider(d.domain, { disposable: d.disposable > 0 && d.disposable === d.total });
    if (!providerMap.has(family)) {
      providerMap.set(family, { provider: family, total: 0, deliverable: 0, undeliverable: 0, unknown: 0, acceptAll: 0 });
    }
    const p = providerMap.get(family);
    p.total += d.total;
    p.deliverable += d.deliverable;
    p.undeliverable += d.undeliverable;
    p.unknown += d.unknown;
    p.acceptAll += d.accepted;
  }
  const providers = [...providerMap.values()]
    .map((p) => ({ ...p, percentages: { undeliverable: pct(p.undeliverable, p.total), unknown: pct(p.unknown, p.total) } }))
    .sort((a, b) => b.total - a.total);

  // ---- Risk signals (deterministic, ranked by impact) ---------------------
  const riskSignals = buildRiskSignals({ total, metrics, weightedRisk });

  // ---- Deterministic recommended actions ----------------------------------
  const recommendations = buildRecommendations({ metrics });

  // Worst domains for the UI (already ranked worst-first by problemScore).
  const domains = domainStats.domains.slice(0, Math.max(1, Math.min(50, domainLimit)));

  return {
    generatedAt: new Date().toISOString(),
    healthScore: score,
    healthLevel: level,
    scoreModel: {
      formula: 'healthScore = clamp(0..100, 100 - Σ(signalPercentage × weight))',
      weights: HEALTH_WEIGHTS,
      weightedRisk,
      components,
      thresholds: HEALTH_LEVELS,
    },
    metrics,
    providers,
    domains,
    riskSignals,
    recommendations,
    // Pass through the deterministic summary score if provided (for context).
    engineSummaryHealth: summary && Number.isFinite(Number(summary.health)) ? round1(Number(summary.health)) : null,
  };
}

// Ranked, evidence-backed risk signals. Only real negatives are HIGH severity;
// UNKNOWN and ACCEPT_ALL are informational and correctly framed.
function buildRiskSignals({ total, metrics }) {
  if (total === 0) return [];
  const p = metrics.percentages;
  const a = metrics.additionalSignals;
  const out = [];
  const push = (code, severity, count, percentage, label, detail) => {
    if (count > 0) out.push({ code, severity, count, percentage, label, detail });
  };

  push('undeliverable', 'high', metrics.undeliverable, p.undeliverable,
    'Undeliverable addresses',
    'Definitive SMTP rejection or invalid domain/syntax. These should be removed before sending.');
  push('disposable', a.disposable >= total * 0.05 ? 'high' : 'medium', a.disposable, pct(a.disposable, total),
    'Disposable / throwaway domains',
    'Temporary mailboxes that are abandoned quickly; contacting them wastes send volume.');
  push('domain_invalid', 'high', a.domainInvalid, pct(a.domainInvalid, total),
    'Domains with no DNS records',
    'The domain does not resolve, so mail cannot be delivered.');
  push('syntax_invalid', 'high', a.syntaxInvalid, pct(a.syntaxInvalid, total),
    'Invalid / unreachable syntax or reserved domains',
    'Malformed addresses or reserved/example domains that cannot receive mail.');
  push('no_mx', 'medium', a.noMx, pct(a.noMx, total),
    'No dedicated mail servers',
    'No MX records; delivery via an implicit A record is less reliable.');
  push('accept_all', 'medium', metrics.acceptAll, p.acceptAll,
    'Accept-all (catch-all) domains',
    'The server accepts mail for arbitrary recipients, so individual mailbox existence cannot be independently confirmed. This is a healthy-infrastructure signal, not a failure.');
  push('unknown', 'low', metrics.unknown, p.unknown,
    'Unknown / unconfirmed results',
    'SMTP evidence was inconclusive (timeout, temporary failure, or transport limitation). These are candidates for later re-verification — not invalid.');
  push('role_based', 'low', a.roleBased, pct(a.roleBased, total),
    'Role / shared mailboxes',
    'Functional addresses (e.g. info@, support@). Deliverable but may not suit person-level campaigns.');

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.count - x.count);
}

// Deterministic recommended actions mapped to real evidence. `actionType`
// lets the frontend wire real existing functionality (export/purge/reverify)
// where available; otherwise the action is informational.
function buildRecommendations({ metrics }) {
  const out = [];
  const p = metrics.percentages;
  if (metrics.undeliverable > 0) {
    out.push({
      priority: 'high', actionType: 'remove_undeliverable',
      action: `Remove ${metrics.undeliverable} undeliverable addresses`,
      reason: `${p.undeliverable}% of the list has definitive negative SMTP evidence. Removing them protects sender reputation before your next campaign.`,
    });
  }
  if (metrics.additionalSignals.disposable > 0) {
    out.push({
      priority: 'high', actionType: 'review_disposable',
      action: `Review ${metrics.additionalSignals.disposable} disposable addresses`,
      reason: 'Disposable mailboxes are abandoned quickly and rarely convert.',
    });
  }
  if (metrics.acceptAll > 0) {
    out.push({
      priority: 'medium', actionType: 'review_accept_all',
      action: `Review ${metrics.acceptAll} accept-all addresses`,
      reason: 'These domains accept mail for any recipient; mailbox existence is unconfirmed. Send with awareness of the limitation.',
    });
  }
  if (metrics.unknown > 0) {
    out.push({
      priority: 'medium', actionType: 'reverify_unknown',
      action: `Re-verify ${metrics.unknown} unknown addresses later`,
      reason: 'Unknown results are unconfirmed (not invalid). Re-verifying where live SMTP is available reduces uncertainty.',
    });
  }
  if (out.length === 0) {
    out.push({
      priority: 'low', actionType: 'maintain',
      action: 'No cleanup required right now',
      reason: 'No definitive negatives detected. Keep scheduled re-verification to maintain quality.',
    });
  }
  return out;
}
