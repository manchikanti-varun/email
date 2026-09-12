import express from 'express';
import { authRequired, chargeCredits, publicUser } from '../auth.js';
import { verifyEmail } from '../verify/engine.js';
import { asyncHandler } from '../middleware.js';
import { db } from '../db.js';

const router = express.Router();

// Single email verification. Costs 1 credit. Used by both the dashboard
// (JWT) and the public REST API (X-API-Key) since authRequired accepts both.
router.post('/single', authRequired, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || email.length > 254) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  if (!chargeCredits(req.user.id, 1)) {
    return res.status(402).json({ error: 'Insufficient credits' });
  }

  const result = await verifyEmail(email);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ result, credits: user.credits, user: publicUser(user) });
}));

export default router;
