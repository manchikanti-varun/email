// Catch-all detection helpers. A domain is "catch-all" when it accepts mail for
// addresses that cannot possibly exist. We test the real target alongside a
// random, almost-certainly-nonexistent local part in the SAME conversation.
//
// catch-all is NOT invalid — it means the specific mailbox cannot be
// independently confirmed. The engine treats it as risky/review.
//
// Catch-all is a DOMAIN property, so we memoize confident accept/reject results
// briefly. Bulk runs with many addresses on the same domain then skip the
// extra random RCPT while still probing every real mailbox.

const CATCHALL_TTL_MS = 10 * 60 * 1000;
const catchAllCache = new Map(); // domain -> { at, isCatchAll }

export function randomLocalPart() {
  return 'no-such-user-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

export function catchAllAddress(email) {
  const domain = email.split('@')[1] || 'invalid.invalid';
  return randomLocalPart() + '@' + domain;
}

// Given the target's status and the random probe's status, decide catch-all.
// Only conclude catch-all when the random address is positively accepted.
export function isCatchAll({ targetStatus, probeStatus }) {
  return probeStatus === 'accepted';
}

/** @returns {boolean|null} cached catch-all flag, or null if unknown/expired */
export function getCachedCatchAll(domain) {
  const hit = catchAllCache.get(String(domain || '').toLowerCase());
  if (hit && Date.now() - hit.at < CATCHALL_TTL_MS) return hit.isCatchAll;
  return null;
}

/** Cache only confident probe outcomes (accepted or rejected). */
export function setCachedCatchAll(domain, isCatchAllFlag) {
  catchAllCache.set(String(domain || '').toLowerCase(), {
    at: Date.now(),
    isCatchAll: !!isCatchAllFlag,
  });
}

/** Test helper — clear memoization between cases. */
export function clearCatchAllCache() {
  catchAllCache.clear();
}
