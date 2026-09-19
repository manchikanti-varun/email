// Verdict stability ("sticky verdict") helper.
//
// Live SMTP verification is inherently network-dependent: the SAME address can
// return a definitive 250/550 one run and time out (→ UNKNOWN) the next, purely
// because of transient network state, greylisting, or rate limits. Overwriting
// a previously CONFIRMED verdict with a fresh INCONCLUSIVE one makes results
// look random between runs and needlessly downgrades good data.
//
// Rule: on re-verify, only REPLACE a prior confident verdict when the new
// result is at least as conclusive. A new inconclusive/UNKNOWN result NEVER
// downgrades a prior confident deliverable/undeliverable/accepted verdict —
// instead we keep the prior verdict (its evidence was stronger). Genuinely new
// negative or positive evidence always wins, so real changes still propagate.
//
// This is deterministic given (prior, next) and does not touch the engine.

const CONFIDENCE_RANK = Object.freeze({ high: 3, medium: 2, low: 1, none: 0 });

// A verdict is "conclusive" when it reflects real mailbox/domain evidence
// rather than an unconfirmed transport failure.
function isConclusive(result) {
  if (!result) return false;
  const d = result.deliverability;
  // deliverable / undeliverable / accepted(catch-all) are conclusive.
  // "unknown" is the inconclusive bucket we must not let clobber good data.
  return d === 'deliverable' || d === 'undeliverable' || d === 'accepted';
}

function confRank(result) {
  return CONFIDENCE_RANK[result?.confidence] ?? 0;
}

/**
 * Decide which verification result to persist for a re-verify.
 *
 * @param {object|null} prior  the contact's currently stored verdict (or null)
 * @param {object} next        the freshly computed verdict
 * @returns {{ result: object, kept: boolean }}
 *          `result` is the verdict to save; `kept` is true when we preserved
 *          the prior verdict instead of the fresh one.
 */
export function chooseStableVerdict(prior, next) {
  // No usable prior evidence, or prior was never conclusively verified → take
  // the new result as-is.
  if (!prior || !isConclusive(prior)) return { result: next, kept: false };

  // New result is conclusive too → it is fresh, real evidence; always take it
  // (handles a mailbox that genuinely started bouncing, a domain that went
  // catch-all, etc.).
  if (isConclusive(next)) return { result: next, kept: false };

  // Here: prior was conclusive, new result is inconclusive (unknown /
  // transport failure / timeout). Keep the stronger prior verdict so a
  // transient network blip does not flip a good address to Unknown.
  return { result: prior, kept: true };
}

export { isConclusive as _isConclusive, confRank as _confRank };
