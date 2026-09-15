// Pure statistics derived from deterministic data (contact rows + history).
// No I/O. These aggregations are FACTS — they only count what the engine
// already decided. Interpretation happens in the analysis modules.
import { pct, round1, domainOf, hasRisk, safeNum } from './common.js';

// Normalises a contact row (domain contact OR raw agent-support projection)
// into the fields the intelligence layer relies on.
function normContact(c) {
  return {
    email: c.email || '',
    deliverability: c.deliverability || c.status || 'unknown',
    confidence: c.confidence || 'unknown',
    classification: c.classification || 'unknown',
    verifiedAt: c.verified_at || c.verifiedAt || null,
    greylisted: !!c.greylisted,
    smtpSource: c.smtpSource || null,
    riskSignals: Array.isArray(c.riskSignals) ? c.riskSignals : [],
  };
}

// Full list-level statistics from contact rows. Everything here is measured.
export function listStatistics(contactsRaw) {
  const contacts = (contactsRaw || []).map(normContact);
  const total = contacts.length;

  const classification = { safe: 0, review: 0, remove: 0, unknown: 0 };
  const deliverability = { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
  const confidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  const risk = { disposable: 0, role_based: 0, catch_all: 0, no_mx: 0, possible_typo: 0, temporary_failure: 0 };
  const smtpSource = { 'local-smtp': 0, 'smtp-worker': 0, none: 0, unrecorded: 0 };
  let greylisted = 0;
  let verified = 0;

  for (const c of contacts) {
    if (classification[c.classification] === undefined) classification[c.classification] = 0;
    classification[c.classification]++;
    if (deliverability[c.deliverability] === undefined) deliverability[c.deliverability] = 0;
    deliverability[c.deliverability]++;
    if (confidence[c.confidence] === undefined) confidence[c.confidence] = 0;
    confidence[c.confidence]++;
    for (const code of Object.keys(risk)) if (hasRisk(c, code)) risk[code]++;
    if (c.greylisted) greylisted++;
    if (c.verifiedAt) verified++;
    const src = c.smtpSource || 'unrecorded';
    if (smtpSource[src] === undefined) smtpSource[src] = 0;
    smtpSource[src]++;
  }

  return {
    total,
    verified,
    unverified: total - verified,
    classification,
    deliverability,
    confidence,
    risk,
    greylisted,
    smtpSource,
    percentages: {
      safe: pct(classification.safe, total),
      review: pct(classification.review, total),
      remove: pct(classification.remove, total),
      unknown: pct(classification.unknown, total),
      deliverable: pct(deliverability.deliverable, total),
      risky: pct(deliverability.risky, total),
      undeliverable: pct(deliverability.undeliverable, total),
      catchAll: pct(risk.catch_all, total),
      disposable: pct(risk.disposable, total),
      role: pct(risk.role_based, total),
    },
  };
}

// Per-domain statistics from contact rows, ranked by a problem score so the
// worst domains surface first. `minContacts` filters out long-tail noise.
export function domainStatistics(contactsRaw, { minContacts = 1 } = {}) {
  const contacts = (contactsRaw || []).map(normContact);
  const map = new Map();

  for (const c of contacts) {
    const d = domainOf(c.email);
    if (!d) continue;
    if (!map.has(d)) {
      map.set(d, {
        domain: d, total: 0,
        deliverable: 0, undeliverable: 0, risky: 0, unknown: 0,
        catchAll: 0, disposable: 0, role: 0, noMx: 0,
      });
    }
    const e = map.get(d);
    e.total++;
    if (e[c.deliverability] !== undefined) e[c.deliverability]++;
    if (hasRisk(c, 'catch_all')) e.catchAll++;
    if (hasRisk(c, 'disposable')) e.disposable++;
    if (hasRisk(c, 'role_based')) e.role++;
    if (hasRisk(c, 'no_mx')) e.noMx++;
  }

  const domains = [...map.values()]
    .filter((e) => e.total >= minContacts)
    .map((e) => {
      const deliverablePct = pct(e.deliverable, e.total);
      const unknownPct = pct(e.unknown, e.total);
      const riskyPct = pct(e.risky, e.total);
      const undeliverablePct = pct(e.undeliverable, e.total);
      const disposablePct = pct(e.disposable, e.total);
      // Problem score: undeliverable + disposable weigh most; unknown/risky
      // moderate. Weighted by contact volume so big domains matter more.
      const problemRate = round1(
        undeliverablePct * 1.0 + disposablePct * 1.0 + riskyPct * 0.5 + unknownPct * 0.5
      );
      const problemScore = round1((problemRate / 100) * Math.log10(e.total + 1) * 100);
      return {
        ...e,
        percentages: {
          deliverable: deliverablePct, unknown: unknownPct, risky: riskyPct,
          undeliverable: undeliverablePct, disposable: disposablePct,
          role: pct(e.role, e.total), catchAll: pct(e.catchAll, e.total),
        },
        problemRate,
        problemScore,
      };
    })
    .sort((a, b) => b.problemScore - a.problemScore);

  return { domainCount: domains.length, domains };
}

// Compares the two most recent history snapshots. Returns null when fewer than
// two snapshots exist (the caller reports "insufficient").
export function snapshotDelta(history) {
  const h = history || [];
  if (h.length < 2) return null;
  const cur = h[h.length - 1];
  const prev = h[h.length - 2];
  const countKeys = ['safe', 'review', 'remove', 'unknown'];
  const counts = {};
  for (const k of countKeys) {
    counts[k] = safeNum(cur.counts?.[k]) - safeNum(prev.counts?.[k]);
  }
  const metricKeys = ['deliverability', 'dataQuality', 'risk', 'domainHealth'];
  const metrics = {};
  for (const k of metricKeys) {
    metrics[k] = round1(safeNum(cur.metrics?.[k]) - safeNum(prev.metrics?.[k]));
  }
  return {
    healthDelta: round1(safeNum(cur.health) - safeNum(prev.health)),
    current: { health: round1(safeNum(cur.health)), counts: cur.counts || {}, metrics: cur.metrics || {}, at: cur.created_at },
    previous: { health: round1(safeNum(prev.health)), counts: prev.counts || {}, metrics: prev.metrics || {}, at: prev.created_at },
    counts,
    metrics,
  };
}
