// Webhooks + alerts endpoints (PDF sections 8 & 10).
import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { fireWebhooks } from '../webhooks.js';

const router = express.Router();

// ---- Webhooks --------------------------------------------------------------
router.get('/webhooks', authRequired, (req, res) => {
  const hooks = db.prepare('SELECT id, url, event, active, created_at FROM webhooks WHERE user_id = ?')
    .all(req.user.id);
  res.json({ webhooks: hooks });
});

router.post('/webhooks', authRequired, (req, res) => {
  const { url, event, secret } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }
  const id = nanoid();
  db.prepare(
    `INSERT INTO webhooks (id, user_id, url, event, secret) VALUES (?, ?, ?, ?, ?)`
  ).run(id, req.user.id, url, event || 'job.completed', secret || null);
  res.json({ id, url, event: event || 'job.completed' });
});

router.delete('/webhooks/:id', authRequired, (req, res) => {
  const info = db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Webhook not found' });
  res.json({ ok: true });
});

// Send a test event to all of the user's webhooks.
router.post('/webhooks/test', authRequired, (req, res) => {
  fireWebhooks(req.user.id, '*', { test: true, message: 'MailHealth test event' });
  res.json({ ok: true });
});

// ---- Alerts ----------------------------------------------------------------
router.get('/alerts', authRequired, (req, res) => {
  const alerts = db.prepare(
    'SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) n FROM alerts WHERE user_id = ? AND read = 0')
    .get(req.user.id).n;
  res.json({ alerts, unread });
});

router.post('/alerts/read', authRequired, (req, res) => {
  db.prepare('UPDATE alerts SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
