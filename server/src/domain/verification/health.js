// Aggregate list-level metrics: overall health score + supporting metrics.
// Pure domain logic — no I/O.
//
// SINGLE SOURCE OF TRUTH FOR HEALTH:
// The overall `health` score uses the SAME weighted-risk model as
// buildListHealth() (server/agent/intelligence/list-health.js):
//
//   health = clamp(0..100, 100 − Σ(signalPercentage × weight))
//
// Previously this function used a different formula (a blend of the mean
// per-contact score, a deliverability metric and a domain-health metric).
// That produced a DIFFERENT number from the "AI List Diagnosis" panel for the
// same list (e.g. 93.4 vs 88.7). Both were deterministic but simply different
// definitions. They are now unified so every panel and the history snapshot
// show one consistent score. If you tune weights, tune HEALTH_WEIGHTS below and
// keep it in sync with list-health.js (or import from a shared module).

// Weighted-risk model weights — MUST match HEALTH_WEIGHTS in list-health.js.
const HEALTH_WEIGHTS = Object.freeze({
  undeliverable: 1.0,
  syntaxInvalid: 1.0,
  domainInvalid: 1.0,
  disposable: 0.9,
  noMx: 0.6,
  unknown: 0.15,
  roleBased: 0.1,
  acceptAll: 0, // catch-all is positive infra; never reduces health
});

export function summarize(contacts) {
  const total = contacts.length;
  const counts = { safe: 0, review: 0, remove: 0, unknown: 0 };
  const statusCounts = {
    deliverable: 0, accepted: 0, undeliverable: 0, risky: 0, unknown: 0,
  };
  let scoreSum = 0;
  let disposable = 0;
  let role = 0;
  let catchAll = 0;
  let noMx = 0;
  let syntaxInvalid = 0;
  let domainInvalid = 0;

  for (const c of contacts) {
    counts[c.classification] = (counts[c.classification] || 0) + 1;
    const st = c.status || c.deliverability || 'unknown';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    scoreSum += Number(c.score) || 0;

    const rsigs = Array.isArray(c.riskSignals) ? c.riskSignals : safeParse(c.risk_signals);
    const codes = new Set(rsigs.map((r) => r.code));
    if (codes.has('disposable')) disposable++;
    if (codes.has('role_based')) role++;
    if (codes.has('catch_all')) catchAll++;
    if (codes.has('no_mx')) noMx++;
    if (codes.has('domain_missing') || c.finalReason === 'domain_missing') domainInvalid++;
    if (c.finalReason === 'invalid_syntax' || c.finalReason === 'reserved_domain') syntaxInvalid++;
  }

  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // Positive/neutral share: everything except definitive removes.
  // Catch-all and unknown do not reduce this metric.
  const positiveOrNeutral = total - counts.remove;
  const deliverabilityMetric = total
    ? Math.round((positiveOrNeutral / total) * 100)
    : 0;

  const dataQuality = total
    ? Math.round(((total - counts.remove) / total) * 100)
    : 0;

  // Risk health: only real defects. Unknown is neutral (no major penalty).
  // Catch-all must not reduce this metric.
  const trueRiskReview = Math.max(0, counts.review); // catch-all no longer lands in review
  const risk = total
    ? Math.round(((total - counts.remove - trueRiskReview * 0.5) / total) * 100)
    : 0;

  const domainHealth = total
    ? Math.round(((total - noMx - disposable) / total) * 100)
    : 0;

  // Retained for context/telemetry only — NOT the health score any more.
  const avgScore = total ? scoreSum / total : 0;

  // Primary health = weighted-risk model, identical to buildListHealth().
  // Each share is a percentage of the whole list (0..100).
  const undeliverable = statusCounts.undeliverable || 0;
  const acceptAll = statusCounts.accepted || 0;
  const unknownCount = counts.unknown || 0;
  const share = {
    undeliverable: pct(undeliverable),
    syntaxInvalid: pct(syntaxInvalid),
    domainInvalid: pct(domainInvalid),
    disposable: pct(disposable),
    noMx: pct(noMx),
    unknown: pct(unknownCount),
    roleBased: pct(role),
    acceptAll: pct(acceptAll),
  };
  const weightedRisk = Object.entries(HEALTH_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + (share[key] ?? 0) * weight,
    0,
  );
  // Empty list => neutral 100 (nothing bad observed).
  const health = total === 0
    ? 100
    : Math.round(clamp(100 - weightedRisk) * 10) / 10;

  return {
    total,
    counts,
    statusCounts,
    percentages: {
      safe: pct(counts.safe),
      review: pct(counts.review),
      remove: pct(counts.remove),
      unknown: pct(counts.unknown),
      accepted: pct(statusCounts.accepted || 0),
      catchAll: pct(catchAll),
    },
    metrics: {
      deliverability: clamp(deliverabilityMetric),
      dataQuality: clamp(dataQuality),
      risk: clamp(risk),
      domainHealth: clamp(domainHealth),
    },
    breakdown: { disposable, role, catchAll, noMx },
    health: clamp(health),
  };
}

function clamp(n) { return Math.max(0, Math.min(100, n)); }
function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }
