import express from 'express';
import { authRequired } from '../auth.js';
import { db } from '../db.js';

const router = express.Router();

function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }

// Campaign preflight: given a verified list, answer "can I safely send this?"
router.get('/:listId/preflight', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.listId, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const contacts = db.prepare('SELECT classification, status, signals FROM contacts WHERE list_id = ?')
    .all(list.id);

  const buckets = { safe: 0, review: 0, catchAll: 0, invalid: 0, disposable: 0, unknown: 0 };
  for (const c of contacts) {
    const signals = safeParse(c.signals);
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

  res.json({
    listName: list.name,
    recipients: total,
    buckets,
    recommendedSendList,
    safePct,
    verdict,
  });
});

export default router;
