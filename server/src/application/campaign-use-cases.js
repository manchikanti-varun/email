// Campaign preflight: given a verified list, answer "can I safely send this?"
//
// CANONICAL SEMANTICS (see domain/verification/verdict-semantics.js):
//   DELIVERABLE   → CONFIRMED   (the ONLY default send list)
//   ACCEPT_ALL    → REVIEW      (catch-all: mailbox NOT independently confirmed)
//   UNKNOWN       → UNCONFIRMED (could not verify — re-verify later)
//   UNDELIVERABLE → BLOCKED     (must not send)
//
// A catch-all acceptance does NOT prove those mailboxes exist, so catch-all and
// unknown are NEVER silently folded into the recommended send list. They are
// surfaced explicitly so the user makes an informed decision.
import { AppError } from './errors.js';
import { tallyVerdicts, resolveVerdict, VERDICT } from '../domain/verification/verdict-semantics.js';

export class CampaignPreflight {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    const contacts = this.contacts.findByList(list.id);
    const total = contacts.length;

    // ONE canonical tally — identical semantics to cleaning summary + health.
    const canon = tallyVerdicts(contacts);

    // Disposable is a sub-category of undeliverable, surfaced separately for the
    // "why" of a blocked recipient. It does not change the counts.
    let disposable = 0;
    for (const c of contacts) {
      if (resolveVerdict(c) !== VERDICT.UNDELIVERABLE) continue;
      const signals = Array.isArray(c.signals) ? c.signals : [];
      const risks = Array.isArray(c.riskSignals) ? c.riskSignals : [];
      if (signals.some((s) => /disposable/i.test(s.label) && s.status === 'fail')
        || risks.some((r) => r && r.code === 'disposable')) disposable++;
    }

    const buckets = {
      confirmed: canon.verdicts.deliverable,           // CONFIRMED — send
      catchAll: canon.verdicts.acceptAll,              // REVIEW — catch-all
      unknown: canon.verdicts.unknown,                 // UNCONFIRMED — reverify
      blocked: canon.verdicts.undeliverable + canon.verdicts.risky, // BLOCKED
      disposable,
      // Backward-compatible aliases (older UI/tests referenced these names).
      safe: canon.verdicts.deliverable,
      review: canon.verdicts.acceptAll + canon.verdicts.risky,
      invalid: canon.verdicts.undeliverable,
    };

    // DEFAULT recommended send list = CONFIRMED only. Catch-all/unknown are NOT
    // eligible unless the user explicitly opts into a broader policy.
    const recommendedSendList = buckets.confirmed;
    const confirmedPct = total ? Math.round((recommendedSendList / total) * 100) : 0;
    const blockedPct = total ? Math.round((buckets.blocked / total) * 100) : 0;
    const reviewPct = total ? Math.round(((buckets.catchAll + buckets.unknown) / total) * 100) : 0;

    let verdict;
    if (confirmedPct >= 70 && blockedPct < 5) {
      verdict = 'Good to send. A strong majority have confirmed mailbox-level evidence. ' +
        'Remove blocked contacts first.';
    } else if (buckets.blocked > 0 || reviewPct >= 30) {
      verdict = 'Send with caution. Only confirmed recipients are proven deliverable; ' +
        'catch-all and unknown recipients are unconfirmed. Remove blocked contacts and ' +
        'decide on review/unconfirmed recipients before sending.';
    } else if (confirmedPct === 0) {
      verdict = 'Not recommended yet. No recipients have confirmed mailbox-level evidence; ' +
        're-verify where live SMTP is available before sending.';
    } else {
      verdict = 'Send with caution. Prefer confirmed recipients; catch-all and unknown ' +
        'recipients cannot be independently confirmed.';
    }

    return {
      listName: list.name,
      recipients: total,
      buckets,
      // Explicit canonical eligibility counts.
      eligibility: {
        confirmed: canon.eligibility.CONFIRMED,
        review: canon.eligibility.REVIEW,
        unconfirmed: canon.eligibility.UNCONFIRMED,
        blocked: canon.eligibility.BLOCKED,
      },
      recommendedSendList,
      confirmedPct,
      reviewPct,
      blockedPct,
      // Backward-compatible name: now the CONFIRMED-only percentage.
      safePct: confirmedPct,
      eligiblePct: confirmedPct,
      verdict,
    };
  }
}
