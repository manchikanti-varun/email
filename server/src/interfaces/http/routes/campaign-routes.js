import express from 'express';
import { asyncHandler } from '../middleware.js';

export function makeCampaignRouter({ campaignPreflight, authRequired }) {
  const router = express.Router();

  router.get('/:listId/preflight', authRequired, asyncHandler((req, res) => {
    res.json(campaignPreflight.execute(req.user.id, req.params.listId));
  }));

  return router;
}
