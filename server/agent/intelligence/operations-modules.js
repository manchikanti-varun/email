// Operations-cluster intelligence: smart cleaning (prioritise, never delete),
// re-verification prioritisation, credit optimisation, and per-email
// explanation. Pure. Deterministic cleaning rules remain authoritative — these
// modules only rank/explain; deletion still flows through the existing
// executor + confirmation + audit path.
import {
  CONFIDENCE, INSUFFICIENT,
  recommendation, round1, safeNum, domainOf, hasRisk,
} from './common.js';

// ---- MODULE 7: Smart Cleaning (prioritisation only) -----------------------
// Buckets follow the deterministic classification; within REVIEW/UNKNOWN we
// add a priority so users know what to examine first. NO deletion here.
export function smartCleaning({ cleaningPlan, contacts }) {
  if (!cleaningPlan) return { available: false, message: INSUFFICIENT };
  const keep = safeNum(cleaningPlan.keep);
  const review = safeNum(cleaningPlan.review);
  const remove = safeNum(cleaningPlan.remove);

  // Prioritise review/unknown contacts by verification uncertainty combined
  // with risk signals. (Relevance-to-campaign data isn't tracked, so we don't
  // pretend to know it.)
  const reviewable = (contacts || []).filter((c) => {
    const cls = c.classification || c.status;
    return cls === 'review' || cls === 'unknown';
  });

  const scored = reviewable.map((c) => {
    let score = 0;
    const conf = c.confidence || 'unknown';
    if (conf === 'low' || conf === 'unknown') score += 40;
    else if (conf === 'medium') score += 20;
    if (hasRisk(c, 'catch_all')) score += 20;
    if (hasRisk(c, 'temporary_failure') || c.greylisted) score += 25; // likely to resolve on retry
    if (hasRisk(c, 'no_mx')) score += 10;
    if (hasRisk(c, 'possible_typo')) score += 15;
    return { email: c.email, score: round1(score), priority: score >= 55 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW' };
  }).sort((a, b) => b.score - a.score);

  const high = scored.filter((s) => s.priority === 'HIGH').length;
  const medium = scored.filter((s) => s.priority === 'MEDIUM').length;
  const low = scored.filter((s) => s.priority === 'LOW').length;

  const recommendations = [];
  if (high > 0) recommendations.push(recommendation(`Examine the ${high} high-priority review contacts first — they combine low verification confidence with meaningful risk signals.`, CONFIDENCE.MEDIUM));
  if (remove > 0) recommendations.push(recommendation(`The ${remove} Remove contacts have strong deterministic evidence they cannot receive mail; deleting them is safe but requires your confirmation.`, CONFIDENCE.HIGH));

  return {
    available: true,
    buckets: { keep, review, remove, reverify: scored.filter((s) => s.priority !== 'LOW').length },
    reviewPriority: { high, medium, low },
    prioritised: scored.slice(0, 100),
    recommendations,
    note: 'AI does not delete contacts. Any deletion runs through the existing confirmation + audit controls.',
  };
}

// ---- MODULE 11: Re-verification Prioritisation ----------------------------
// Ranks contacts by expected information gain per credit: stale, low-confidence,
// greylisted, or catch-all contacts are most worth re-checking.
export function prioritizeReverification({ contacts, now = Date.now() }) {
  const rows = contacts || [];
  if (rows.length === 0) return { available: false, message: INSUFFICIENT, priority: [] };

  const scored = rows.map((c) => {
    let score = 0;
    const reasons = [];

    const verifiedAt = Date.parse(c.verified_at || c.verifiedAt || '');
    if (!Number.isFinite(verifiedAt)) { score += 30; reasons.push('never verified'); }
    else {
      const ageDays = (now - verifiedAt) / 86400000;
      if (ageDays > 90) { score += 30; reasons.push(`last verified ${Math.round(ageDays)}d ago`); }
      else if (ageDays > 30) { score += 15; reasons.push(`last verified ${Math.round(ageDays)}d ago`); }
    }

    const conf = c.confidence || 'unknown';
    if (conf === 'low' || conf === 'unknown') { score += 25; reasons.push('low/unknown confidence'); }
    else if (conf === 'medium') { score += 10; }

    const cls = c.classification || c.status;
    if (cls === 'unknown') { score += 20; reasons.push('unknown deliverability'); }
    if (c.greylisted || hasRisk(c, 'temporary_failure')) { score += 25; reasons.push('greylisted / temporary failure (likely resolves on retry)'); }
    if (hasRisk(c, 'catch_all')) { score += 10; reasons.push('catch-all domain'); }

    // Safe, high-confidence contacts gain little from re-checking.
    if (cls === 'safe' && conf === 'high') score = Math.max(0, score - 20);

    const priority = score >= 60 ? 'URGENT' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
    return { email: c.email, priorityScore: round1(score), priority, reason: reasons.join('; ') || 'stable; low expected change' };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const buckets = { URGENT: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const s of scored) buckets[s.priority]++;

  return {
    available: true,
    total: scored.length,
    buckets,
    priority: scored,
    note: 'Ranked by expected information gain per credit; not a claim about individual outcomes.',
  };
}

// ---- MODULE 12: Credit Optimisation ---------------------------------------
// Allocates a credit budget to the highest-value contacts first.
export function optimizeCredits({ prioritized, availableCredits, costPerVerify = 1 }) {
  if (!prioritized || !prioritized.priority) return { available: false, message: INSUFFICIENT };
  const ranked = prioritized.priority;
  const budget = safeNum(availableCredits);
  const dueTotal = ranked.length;
  const worthVerifying = ranked.filter((r) => r.priority !== 'LOW'); // low = low expected value
  const affordableCount = Math.min(worthVerifying.length, Math.floor(budget / costPerVerify));

  const recommendations = [];
  if (dueTotal * costPerVerify <= budget) {
    recommendations.push(recommendation(`You can re-verify all ${dueTotal} due contacts within your ${budget} credits.`, CONFIDENCE.HIGH));
  } else {
    recommendations.push(recommendation(
      `You have ${budget} credits but ${dueTotal} contacts due. Prioritising the ${affordableCount} highest-value contacts spends ${affordableCount * costPerVerify} credits for the greatest expected information gain; the ${dueTotal - affordableCount} low-value contacts can wait.`,
      CONFIDENCE.MEDIUM
    ));
  }
  const skippableLow = ranked.filter((r) => r.priority === 'LOW').length;
  if (skippableLow > 0) recommendations.push(recommendation(`${skippableLow} contacts are low expected-change; deferring them saves ${skippableLow * costPerVerify} credits.`, CONFIDENCE.MEDIUM));

  return {
    available: true,
    availableCredits: budget,
    dueContacts: dueTotal,
    recommendedVerifyCount: affordableCount,
    estimatedCreditsRequired: affordableCount * costPerVerify,
    estimatedCreditsSaved: (dueTotal - affordableCount) * costPerVerify,
    recommendations,
    note: 'Estimates are computed from priority ranking and cost, not guaranteed savings.',
  };
}

// ---- MODULE 8: Per-Email Explanation --------------------------------------
// Two audiences from the SAME evidence. Adds no technical fact not present in
// the contact's evidence/signals.
export function explainEmail({ contact, mode = 'simple' }) {
  if (!contact || !contact.email) return { available: false, message: INSUFFICIENT };
  const deliverability = contact.deliverability || contact.status || 'unknown';
  const confidence = contact.confidence || 'unknown';
  const action = contact.recommendedAction || contact.recommended_action || contact.classification || 'review';
  const signals = Array.isArray(contact.signals) ? contact.signals : [];
  const risks = Array.isArray(contact.riskSignals) ? contact.riskSignals : [];
  const engineReasons = Array.isArray(contact.reasons) ? contact.reasons : [];

  const catchAll = risks.some((r) => r.code === 'catch_all');
  const role = risks.some((r) => r.code === 'role_based');
  const disposable = risks.some((r) => r.code === 'disposable');
  const greylisted = !!contact.greylisted || risks.some((r) => r.code === 'temporary_failure');

  let simple;
  if (deliverability === 'deliverable') simple = 'This email appears deliverable — the mailbox was confirmed to accept mail.';
  else if (deliverability === 'undeliverable') simple = 'This email cannot receive mail and should be removed.';
  else if (deliverability === 'accepted' || catchAll) simple = 'Accepted by a catch-all mail server. Individual mailbox existence cannot be independently confirmed. This is campaign-eligible — not a failure.';
  else if (deliverability === 'risky') simple = 'This address has risk signals that warrant human review before sending.';
  else if (greylisted) simple = 'The mail server gave a temporary response; a later re-check should clarify this address.';
  else simple = 'This email could not be confirmed. It is unconfirmed rather than invalid, and is a candidate for re-verification.';
  if (role) simple += ' It is a shared/role mailbox, which is a characteristic, not a fault.';
  if (disposable) simple = 'This is a disposable/temporary address and should not be contacted.';

  // Technical mode: only restate observed evidence.
  const techBits = [];
  const passed = signals.filter((s) => s.status === 'pass').map((s) => s.label);
  const failed = signals.filter((s) => s.status === 'fail').map((s) => s.label);
  const warned = signals.filter((s) => s.status === 'warn').map((s) => s.label);
  if (passed.length) techBits.push(`Passed: ${passed.join(', ')}.`);
  if (warned.length) techBits.push(`Warnings: ${warned.join(', ')}.`);
  if (failed.length) techBits.push(`Failed: ${failed.join(', ')}.`);
  const technical = (techBits.join(' ') || 'No technical evidence recorded for this contact.') +
    ` Deliverability=${deliverability}, confidence=${confidence}, action=${action}.`;

  return {
    available: true,
    email: contact.email,
    deliverability,
    confidence,
    recommendedAction: action,
    explanation: mode === 'technical' ? technical : simple,
    simple,
    technical,
    engineReasons,
    note: 'Derived only from the deterministic verification evidence; no extra facts added.',
  };
}
