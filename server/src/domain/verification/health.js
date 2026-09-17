// Aggregate list-level metrics: overall health score + supporting metrics.
// Pure domain logic — no I/O.

export function summarize(contacts) {
  const total = contacts.length;
  const counts = { safe: 0, review: 0, remove: 0, unknown: 0 };
  const statusCounts = { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
  let scoreSum = 0;
  let disposable = 0;
  let role = 0;
  let catchAll = 0;
  let noMx = 0;

  for (const c of contacts) {
    counts[c.classification] = (counts[c.classification] || 0) + 1;
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    scoreSum += c.score || 0;

    // Prefer the structured risk signals; fall back to a JSON string field.
    const rsigs = Array.isArray(c.riskSignals) ? c.riskSignals : safeParse(c.risk_signals);
    const codes = new Set(rsigs.map((r) => r.code));
    if (codes.has('disposable')) disposable++;
    if (codes.has('role_based')) role++;
    if (codes.has('catch_all')) catchAll++;
    if (codes.has('no_mx')) noMx++;
  }

  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // Catch-all contacts sit in "review" but are healthy mail paths — give them
  // strong partial credit (not the same as proven Safe, not a health failure).
  const deliverability = total
    ? Math.round(((counts.safe + counts.review * 0.85) / total) * 100)
    : 0;
  // Data quality = share of addresses that are NOT undeliverable. Being
  // role-based / catch-all does NOT reduce data quality — those are characteristics.
  const dataQuality = total
    ? Math.round(((total - counts.remove) / total) * 100)
    : 0;
  // "Risk health": only real defects (and unknowns) weigh. Catch-all review is
  // not counted as a risk defect (same philosophy as role-based).
  const reviewAsRisk = Math.max(0, counts.review - catchAll);
  const risk = total
    ? Math.round(((total - reviewAsRisk - counts.unknown) / total) * 100)
    : 0;
  const domainHealth = total
    ? Math.round(((total - noMx - disposable) / total) * 100)
    : 0;

  const avgScore = total ? scoreSum / total : 0;
  const health = Math.round(
    (avgScore * 0.6 + deliverability * 0.2 + domainHealth * 0.1 + risk * 0.1) * 10
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
    },
    metrics: {
      deliverability: clamp(deliverability),
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
