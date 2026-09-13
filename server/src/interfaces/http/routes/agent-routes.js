// HTTP surface for the MailHealth AI agent. Thin: maps request/response to the
// AgentChat use-case. Auth-guarded — the agent always acts as the current user.
import express from 'express';
import { asyncHandler } from '../middleware.js';

export function makeAgentRouter({ agentChat, agentHistory, authRequired }) {
  const router = express.Router();

  // POST /api/agent/chat
  // Body: { message, listId?, conversationId?, confirm? }
  // Response: { conversationId, message, actions, sources, pendingConfirmation, ... }
  router.post('/chat', authRequired, asyncHandler(async (req, res) => {
    const { message, listId, conversationId, confirm } = req.body || {};
    const result = await agentChat.execute(req.user, { message, listId, conversationId, confirm });
    res.json(result);
  }));

  // GET /api/agent/history?conversationId=... — the audit trail (read-only).
  router.get('/history', authRequired, asyncHandler((req, res) => {
    res.json(agentHistory.execute(req.user.id, req.query.conversationId));
  }));

  return router;
}
