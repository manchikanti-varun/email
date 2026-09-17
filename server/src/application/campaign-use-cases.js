// Campaign preflight: given a verified list, answer "can I safely send this?"
// Catch-all addresses are campaign-eligible (accepted), not failures.
import { AppError } from './errors.js';

function isCatchAllContact(c) {
  if (c.acceptanceType === 'CATCH_ALL') return true;
  if (c.mailboxStatus === 'ACCEPT_ALL') return true;
  if ((c.status || c.deliverability) === 'accepted') return true;
  const signals = Array.isArray(c.signals) ? c.signals : [];
  if (signals.some((s) => /catch-all/i.test(s.label))) return true;
  const risks = Array.isArray(c.riskSignals) ? c.riskSignals : [];
  return risks.some((r) => r && r.code === 'catch_all');
}

export class CampaignPreflight {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    const contacts = this.contacts.findByList(list.id);

    const buckets = { safe: 0, review: 0, catchAll: 0, invalid: 0, disposable: 0, unknown: 0 };
    for (const c of contacts) {
      const signals = Array.isArray(c.signals) ? c.signals : [];
      const isDisposable = signals.some((s) => /disposable/i.test(s.label) && s.status === 'fail');
      const catchAll = isCatchAllContact(c);

      if (c.classification === 'remove' && isDisposable) buckets.disposable++;
      else if (c.classification === 'remove') buckets.invalid++;
      else if (catchAll) buckets.catchAll++;
      else if (c.classification === 'safe') buckets.safe++;
      else if (c.classification === 'unknown') buckets.unknown++;
      else buckets.review++;
    }

    const total = contacts.length;
    // Catch-all is campaign-eligible alongside proven Safe.
    const recommendedSendList = buckets.safe + buckets.catchAll;
    const eligiblePct = total ? Math.round((recommendedSendList / total) * 100) : 0;
    const removePct = total
      ? Math.round(((buckets.invalid + buckets.disposable) / total) * 100)
      : 0;

    let verdict;
    if (eligiblePct >= 85 && removePct < 10) {
      verdict = 'Good to send. Safe and accepted (catch-all) recipients are campaign-eligible.';
    } else if (eligiblePct >= 60) {
      verdict = removePct > 0
        ? 'Send with caution. Prefer Safe + Accepted recipients; remove undeliverable contacts first.'
        : 'Send with caution. Prefer Safe + Accepted recipients; re-verify unknowns if needed.';
    } else if (removePct >= 20) {
      verdict = 'Not recommended. Clean undeliverable/disposable contacts before sending to protect sender reputation.';
    } else {
      verdict = 'Not recommended. Too few campaign-eligible recipients; clean or re-verify first.';
    }

    return {
      listName: list.name,
      recipients: total,
      buckets,
      recommendedSendList,
      safePct: eligiblePct, // backward-compatible name: now means campaign-eligible %
      eligiblePct,
      verdict,
    };
  }
}
