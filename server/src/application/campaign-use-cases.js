// Campaign preflight: given a verified list, answer "can I safely send this?"
import { AppError } from './errors.js';

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
      const isCatchAll = signals.some((s) => /catch-all/i.test(s.label));

      if (c.classification === 'safe') buckets.safe++;
      else if (c.classification === 'remove' && isDisposable) buckets.disposable++;
      else if (c.classification === 'remove') buckets.invalid++;
      else if (isCatchAll) buckets.catchAll++;
      else if (c.classification === 'unknown') buckets.unknown++;
      else buckets.review++;
    }

    const total = contacts.length;
    const recommendedSendList = buckets.safe;
    const safePct = total ? Math.round((buckets.safe / total) * 100) : 0;

    let verdict;
    if (safePct >= 85) verdict = 'Good to send. Your recommended list is healthy.';
    else if (safePct >= 60) verdict = 'Send with caution. Consider removing risky and invalid contacts first.';
    else verdict = 'Not recommended. Clean the list before sending to protect sender reputation.';

    return { listName: list.name, recipients: total, buckets, recommendedSendList, safePct, verdict };
  }
}
