// Aggregate list-level metrics: overall health score + supporting metrics.
// Pure domain logic — no I/O.
//
// Health is derived from actual positive/negative evidence (per-contact scores),
// NOT from Safe/Total. Catch-all and unknown do not apply major penalties;
// only strong negatives (remove / disposable / no-MX) pull health down.

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

  // Primary health = mean per-contact evidence score (catch-all scores 100,
  // unknown ~80, remove ~5). Do NOT use Safe/Total.
  const avgScore = total ? scoreSum / total : 0;
  const health = Math.round(
    (avgScore * 0.75 + deliverabilityMetric * 0.15 + domainHealth * 0.1) * 10
  ) / 10;

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
