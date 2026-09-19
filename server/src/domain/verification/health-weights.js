// CANONICAL health-score model — shared by health.summarize() and
// list-health.buildListHealth() so the number can never diverge.
//
//   healthScore = clamp(0..100, 100 − Σ(signalPercentage × weight))
//
// The score answers: "How much confidence do we have in this list's VERIFIED
// mailbox quality?" — NOT "how many domains have working mail infrastructure".
// Therefore uncertainty (UNKNOWN, ACCEPT_ALL) has a MEANINGFUL cost: a list
// that is mostly unverifiable should not read as ~100.
//
// Weight rationale (share-of-list × weight, weights 0..1):
//   undeliverable  1.00  definitive negative evidence (worst)
//   syntaxInvalid  1.00  cannot receive mail
//   domainInvalid  1.00  domain has no DNS / cannot receive mail
//   disposable     0.90  throwaway mailboxes; harmful to send to
//   noMx           0.60  no dedicated mail servers (less reliable)
//   unknown        0.35  inconclusive — NOT invalid, but NOT harmless either;
//                        a large unknown share genuinely lowers confidence
//   acceptAll      0.25  catch-all — infra-positive, but mailbox existence is
//                        UNCONFIRMED, so it cannot count as proven quality
//   roleBased      0.10  a characteristic, not a defect (tiny nudge)
//
// Only DELIVERABLE contributes zero penalty (it is the confirmed-positive
// state). UNDELIVERABLE has the strongest negative impact. The weighted risk is
// capped so a fully-bad list floors at 0.
export const HEALTH_WEIGHTS = Object.freeze({
  undeliverable: 1.0,
  syntaxInvalid: 1.0,
  domainInvalid: 1.0,
  disposable: 0.9,
  noMx: 0.6,
  unknown: 0.35,
  acceptAll: 0.25,
  roleBased: 0.1,
});

export const HEALTH_LEVELS = Object.freeze([
  { min: 90, level: 'Excellent' },
  { min: 75, level: 'Good' },
  { min: 60, level: 'Needs Attention' },
  { min: 40, level: 'Poor' },
  { min: 0, level: 'Critical' },
]);

export function healthLevel(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  for (const t of HEALTH_LEVELS) if (s >= t.min) return t.level;
  return 'Critical';
}
