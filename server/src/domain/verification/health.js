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
// show one consistent score. Weights live in the shared health-weights.js
// module so this function and buildListHealth() can never diverge.
import { HEALTH_WEIGHTS } from './health-weights.js';
import { tallyVerdicts } from './verdict-semantics.js';

export function summarize(contacts) {
  const total = contacts.length;
  const counts = { safe: 0, review: 0, remove: 0, unknown: 0 };
  const statusCounts = {
    deliverable: 0, accepted: 0, undeliverable: 0, risky: 0, unknown: 0,
  };
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

  // Canonical bucket + verdict tally — the ONE source of truth for counts.
  // This guarantees Cleaning Summary counts match every other consumer:
  // catch-all → review (NOT safe), unknown stays its own bucket.
  const canon = tallyVerdicts(contacts);
  // Overwrite the raw classification counts with the canonical buckets so a
  // stale/legacy classification on an old row cannot desync the summary.
  counts.safe = canon.cleaning.safe;
  counts.review = canon.cleaning.review;
  counts.remove = canon.cleaning.remove;
  counts.unknown = canon.cleaning.unknown;

  const deliverable = canon.verdicts.deliverable;
  const undeliverable = canon.verdicts.undeliverable;
  const acceptAll = canon.verdicts.acceptAll;
  const unknownCount = canon.verdicts.unknown;

  // PRECISE, HONESTLY-NAMED METRICS (no more "(total − remove)/total = 99%").
  //
  // mailboxDeliverability = confirmed mailbox-level positive evidence only.
  //   For the 291 fixture this is 98/291 ≈ 33.7% — NOT 99%.
  const mailboxDeliverability = total ? Math.round((deliverable / total) * 100) : 0;
  // Infrastructure acceptance (catch-all): server accepted, mailbox unconfirmed.
  const catchAllAcceptance = total ? Math.round((acceptAll / total) * 100) : 0;
  // Share we could not conclusively verify (unknown).
  const unconfirmed = total ? Math.round((unknownCount / total) * 100) : 0;
  // Data quality = share with NO definitive hard failure (remove).
  const dataQuality = total ? Math.round(((total - counts.remove) / total) * 100) : 0;
  // Domain / infrastructure health = MX present, not disposable. This is an
  // INFRASTRUCTURE metric and must never be read as mailbox deliverability.
  const domainHealth = total
    ? Math.round(((total - noMx - disposable) / total) * 100)
    : 0;

  // Primary health = weighted-risk model, identical to buildListHealth().
  // Each share is a percentage of the whole list (0..100).
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
    // Canonical verdict counts + campaign eligibility, exposed for every UI.
    verdicts: canon.verdicts,
    eligibility: canon.eligibility,
    confirmedEligible: canon.confirmedEligible,
    percentages: {
      safe: pct(counts.safe),
      review: pct(counts.review),
      remove: pct(counts.remove),
      unknown: pct(counts.unknown),
      // Precise verdict shares (mailbox-level).
      deliverable: canon.percentages.deliverable,
      undeliverable: canon.percentages.undeliverable,
      acceptAll: canon.percentages.acceptAll,
      accepted: canon.percentages.acceptAll, // backward-compatible alias
      catchAll: canon.percentages.acceptAll,
      unknownVerdict: canon.percentages.unknown,
    },
    metrics: {
      // RENAMED for honesty. `deliverability` now means CONFIRMED mailbox-level
      // deliverability (deliverable/total), not "everything except removes".
      deliverability: clamp(mailboxDeliverability),
      mailboxDeliverability: clamp(mailboxDeliverability),
      catchAllAcceptance: clamp(catchAllAcceptance),
      unconfirmed: clamp(unconfirmed),
      dataQuality: clamp(dataQuality),
      domainHealth: clamp(domainHealth),
    },
    breakdown: { disposable, role, catchAll, noMx },
    health: clamp(health),
  };
}

function clamp(n) { return Math.max(0, Math.min(100, n)); }
function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }
