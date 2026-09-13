// Catch-all detection helpers. A domain is "catch-all" when it accepts mail for
// addresses that cannot possibly exist. We test the real target alongside a
// random, almost-certainly-nonexistent local part in the SAME conversation.
//
// catch-all is NOT invalid — it means the specific mailbox cannot be
// independently confirmed. The engine treats it as risky/review.

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
