import express from 'express';
import { asyncHandler } from '../middleware.js';

export function makeIntegrationRouter({
  listWebhooks, addWebhook, deleteWebhook, testWebhooks,
  listAlerts, markAlertsRead, authRequired,
}) {
  const router = express.Router();

  // ---- Webhooks ----
  router.get('/webhooks', authRequired, asyncHandler((req, res) => {
    res.json(listWebhooks.execute(req.user.id));
  }));
  router.post('/webhooks', authRequired, asyncHandler((req, res) => {
    res.json(addWebhook.execute(req.user.id, req.body || {}));
  }));
  router.delete('/webhooks/:id', authRequired, asyncHandler((req, res) => {
    res.json(deleteWebhook.execute(req.user.id, req.params.id));
  }));
  router.post('/webhooks/test', authRequired, asyncHandler((req, res) => {
    res.json(testWebhooks.execute(req.user.id));
  }));

  // ---- Alerts ----
  router.get('/alerts', authRequired, asyncHandler((req, res) => {
    res.json(listAlerts.execute(req.user.id));
  }));
  router.post('/alerts/read', authRequired, asyncHandler((req, res) => {
    res.json(markAlertsRead.execute(req.user.id));
  }));

  return router;
}
