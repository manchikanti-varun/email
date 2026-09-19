// CANONICAL VERDICT SEMANTICS — the single source of truth for how a
// per-contact verification verdict maps to every downstream interpretation:
// classification, cleaning bucket, campaign eligibility, and cleanup action.
//
// WHY THIS EXISTS
// Previously the meaning of a verdict was re-derived independently in several
// places (engine.mapAction, health.summarize, statistics, campaign preflight,
// exports, cleaning plan). Catch-all in particular leaked into "Safe" in some
// places and "Accepted" in others, so the Cleaning Summary, Deliverability
// metric, Campaign Preflight and Health score disagreed. This module fixes that
// by defining the semantics ONCE. Every consumer must import from here.
//
// IMPORTANT SEMANTIC RULES (do not weaken):
//   * DELIVERABLE  — positive mailbox-level SMTP evidence. The ONLY confirmed
//                    campaign-eligible state.
//   * UNDELIVERABLE— definitive negative SMTP evidence. Remove / blocked.
//   * UNKNOWN      — inconclusive (timeout / transport / worker unavailable /
//                    temporary). NOT deliverable, NOT invalid, NOT safe.
//   * ACCEPT_ALL   — catch-all: server accepts arbitrary recipients, so the
//                    specific mailbox CANNOT be independently confirmed. It is
//                    an infrastructure-positive signal, NOT mailbox proof.
//                    → REVIEW, not Safe, not Confirmed.
//
// This module contains NO I/O and does NOT change SMTP verification. It only
// interprets a verdict the engine already produced.

// ---- Canonical verdict keys (align with DELIVERABILITY in engine.js) -------
export const VERDICT = Object.freeze({
  DELIVERABLE: 'deliverable',
  UNDELIVERABLE: 'undeliverable',
  UNKNOWN: 'unknown',
  ACCEPT_ALL: 'accept_all',
  RISKY: 'risky',
});

// ---- Cleaning buckets (what the "Cleaning summary" shows) ------------------
export const CLEANING_BUCKET = Object.freeze({
  SAFE: 'safe',       // confirmed deliverable
  REVIEW: 'review',   // catch-all / ambiguous — human decision
  REVERIFY: 'unknown',// inconclusive — re-verify later (kept visible, not hidden)
  REMOVE: 'remove',   // definitive negative
});

// ---- Campaign eligibility (explicit; never implies more than evidence) -----
export const CAMPAIGN_ELIGIBILITY = Object.freeze({
  CONFIRMED: 'CONFIRMED', // positive mailbox evidence — send
  REVIEW: 'REVIEW',       // accepted-by-catch-all — mailbox not confirmed
  UNCONFIRMED: 'UNCONFIRMED', // unknown — could not verify
  BLOCKED: 'BLOCKED',     // undeliverable — must not send
});

// ---- Cleanup action (per-contact recommended action) -----------------------
export const CLEANUP_ACTION = Object.freeze({
  KEEP: 'keep',
  REVIEW: 'review',
  REVERIFY: 'reverify',
  REMOVE: 'remove',
});

// ---- The canonical table ----------------------------------------------------
// One row per verdict. Everything downstream reads from here.
const SEMANTICS = Object.freeze({
  [VERDICT.DELIVERABLE]: {
    classification: CLEANING_BUCKET.SAFE,
    cleaningBucket: CLEANING_BUCKET.SAFE,
    campaignEligibility: CAMPAIGN_ELIGIBILITY.CONFIRMED,
    action: CLEANUP_ACTION.KEEP,
    campaignEligible: true, // eligible for the default (confirmed-only) send list
    label: 'Deliverable',
  },
  [VERDICT.UNDELIVERABLE]: {
    classification: CLEANING_BUCKET.REMOVE,
    cleaningBucket: CLEANING_BUCKET.REMOVE,
    campaignEligibility: CAMPAIGN_ELIGIBILITY.BLOCKED,
    action: CLEANUP_ACTION.REMOVE,
    campaignEligible: false,
    label: 'Undeliverable',
  },
  [VERDICT.ACCEPT_ALL]: {
    classification: CLEANING_BUCKET.REVIEW,
    cleaningBucket: CLEANING_BUCKET.REVIEW,
    campaignEligibility: CAMPAIGN_ELIGIBILITY.REVIEW,
    action: CLEANUP_ACTION.REVIEW,
    campaignEligible: false, // NOT confirmed — mailbox existence unproven
    label: 'Catch-All / Unconfirmed',
  },
  [VERDICT.UNKNOWN]: {
    classification: CLEANING_BUCKET.REVERIFY,
    cleaningBucket: CLEANING_BUCKET.REVERIFY,
    campaignEligibility: CAMPAIGN_ELIGIBILITY.UNCONFIRMED,
    action: CLEANUP_ACTION.REVERIFY,
    campaignEligible: false,
    label: 'Unknown / Unconfirmed',
  },
  [VERDICT.RISKY]: {
    classification: CLEANING_BUCKET.REVIEW,
    cleaningBucket: CLEANING_BUCKET.REVIEW,
    campaignEligibility: CAMPAIGN_ELIGIBILITY.REVIEW,
    action: CLEANUP_ACTION.REVIEW,
    campaignEligible: false,
    label: 'Risky',
  },
});

const UNKNOWN_ROW = SEMANTICS[VERDICT.UNKNOWN];

// ---- Verdict resolution -----------------------------------------------------
// Normalises a contact (or a raw verdict string) into a canonical verdict key.
// Catch-all is detected from the engine's authoritative signals FIRST, because
// a catch-all contact carries deliverability='accepted' which must map to
// ACCEPT_ALL (not be confused with DELIVERABLE).
export function isCatchAll(contact) {
  if (!contact || typeof contact !== 'object') return false;
  if (contact.acceptanceType === 'CATCH_ALL') return true;
  if (contact.mailboxStatus === 'ACCEPT_ALL') return true;
  const status = contact.status || contact.deliverability;
  if (status === 'accepted') return true;
  const risks = Array.isArray(contact.riskSignals) ? contact.riskSignals : [];
  if (risks.some((r) => r && r.code === 'catch_all')) return true;
  const signals = Array.isArray(contact.signals) ? contact.signals : [];
  return signals.some((s) => s && /catch-all/i.test(s.label || ''));
}

/**
 * Resolve the canonical verdict for a contact row.
 * @returns {string} one of VERDICT.*
 */
export function resolveVerdict(contact) {
  if (!contact) return VERDICT.UNKNOWN;
  const raw = String(contact.deliverability || contact.status || 'unknown').toLowerCase();

  if (raw === 'undeliverable') return VERDICT.UNDELIVERABLE;
  // Catch-all must win over a bare "accepted" and never be read as deliverable.
  if (isCatchAll(contact)) return VERDICT.ACCEPT_ALL;
  if (raw === 'accepted') return VERDICT.ACCEPT_ALL;
  if (raw === 'deliverable') return VERDICT.DELIVERABLE;
  if (raw === 'risky') return VERDICT.RISKY;
  return VERDICT.UNKNOWN;
}

/** Full canonical semantics for a contact (or verdict key). */
export function semanticsFor(contactOrVerdict) {
  const verdict = typeof contactOrVerdict === 'string'
    ? contactOrVerdict
    : resolveVerdict(contactOrVerdict);
  return SEMANTICS[verdict] || UNKNOWN_ROW;
}

export function classificationFor(contact) { return semanticsFor(contact).classification; }
export function cleaningBucketFor(contact) { return semanticsFor(contact).cleaningBucket; }
export function campaignEligibilityFor(contact) { return semanticsFor(contact).campaignEligibility; }
export function actionFor(contact) { return semanticsFor(contact).action; }
export function isCampaignEligible(contact) { return semanticsFor(contact).campaignEligible; }

/**
 * Tally a list of contacts into canonical buckets in ONE pass. This is the
 * function every aggregation (cleaning summary, preflight, health, exports)
 * should build on so counts can never diverge.
 *
 * @returns {{
 *   total:number,
 *   verdicts:{deliverable:number,undeliverable:number,unknown:number,acceptAll:number,risky:number},
 *   cleaning:{safe:number,review:number,unknown:number,remove:number},
 *   eligibility:{CONFIRMED:number,REVIEW:number,UNCONFIRMED:number,BLOCKED:number},
 *   percentages:object
 * }}
 */
export function tallyVerdicts(contacts) {
  const rows = Array.isArray(contacts) ? contacts : [];
  const total = rows.length;
  const verdicts = { deliverable: 0, undeliverable: 0, unknown: 0, acceptAll: 0, risky: 0 };
  const cleaning = { safe: 0, review: 0, unknown: 0, remove: 0 };
  const eligibility = { CONFIRMED: 0, REVIEW: 0, UNCONFIRMED: 0, BLOCKED: 0 };

  const VERDICT_TO_COUNT = {
    [VERDICT.DELIVERABLE]: 'deliverable',
    [VERDICT.UNDELIVERABLE]: 'undeliverable',
    [VERDICT.UNKNOWN]: 'unknown',
    [VERDICT.ACCEPT_ALL]: 'acceptAll',
    [VERDICT.RISKY]: 'risky',
  };

  for (const c of rows) {
    const verdict = resolveVerdict(c);
    const sem = SEMANTICS[verdict] || UNKNOWN_ROW;
    verdicts[VERDICT_TO_COUNT[verdict]]++;
    cleaning[sem.cleaningBucket] = (cleaning[sem.cleaningBucket] || 0) + 1;
    eligibility[sem.campaignEligibility] = (eligibility[sem.campaignEligibility] || 0) + 1;
  }

  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    total,
    verdicts,
    cleaning,
    eligibility,
    // Confirmed-only send list by default. Catch-all/unknown are NOT included
    // unless a caller explicitly opts into a broader policy.
    confirmedEligible: eligibility.CONFIRMED,
    percentages: {
      deliverable: pct(verdicts.deliverable),
      undeliverable: pct(verdicts.undeliverable),
      unknown: pct(verdicts.unknown),
      acceptAll: pct(verdicts.acceptAll),
      risky: pct(verdicts.risky),
    },
  };
}

export const VERDICT_SEMANTICS_TABLE = SEMANTICS;
