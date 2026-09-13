import express from 'express';
import { asyncHandler } from '../middleware.js';

export function makeVerifyRouter({ verifySingleEmail, authRequired }) {
  const router = express.Router();

  // Single email verification (JWT/cookie or X-API-Key). Costs 1 credit.
  router.post('/single', authRequired, asyncHandler(async (req, res) => {
    const result = await verifySingleEmail.execute(req.user.id, req.body?.email);
    res.json(result); // { result, credits, user }
  }));

  return router;
}
