// Builds the agent's working context from the authenticated user. Kept compact
// and PII-minimal: aggregate metrics and verdicts only, never the full contact
// database. The agent retrieves finer detail on demand through tools.
import { minimizeForPrompt } from './guardrails.js';

export function buildContext({ userId, useCases, hintListId, memory }) {
  const ctx = {
    user: null,
    credits: null,
    lists: [],
    relevantListId: hintListId || memory?.currentListId || null,
    relevantList: null,
    recentAlerts: [],
    recentActions: [],
    pendingConfirmation: memory?.pendingConfirmation
      ? { tool: memory.pendingConfirmation.tool, summary: memory.pendingConfirmation.summary }
      : null,
  };

  try {
    const credits = useCases.getAccountCredits.execute(userId);
    ctx.credits = credits.credits;
    ctx.user = { plan: credits.plan };
  } catch { /* ignore */ }

  try {
    const { lists } = useCases.getLists.execute(userId);
    ctx.lists = lists.map((l) => ({ id: l.id, name: l.name, total: l.total, status: l.status, health: l.health }));
    if (!ctx.relevantListId && ctx.lists.length === 1) ctx.relevantListId = ctx.lists[0].id;
  } catch { /* ignore */ }

  if (ctx.relevantListId) {
    try {
      const d = useCases.getListDetail.execute(userId, ctx.relevantListId);
      ctx.relevantList = {
        id: d.list.id, name: d.list.name, total: d.list.total, status: d.list.status,
        health: d.summary?.health ?? null,
        counts: d.summary?.counts ?? null,
        metrics: d.summary?.metrics ?? null,
        delta: d.delta,
        historyPoints: (d.history || []).length,
      };
    } catch { ctx.relevantListId = null; }
  }

  try {
    const { alerts } = useCases.listAlerts.execute(userId);
    ctx.recentAlerts = (alerts || []).slice(0, 5).map((a) => ({
      level: a.level, title: a.title, at: a.created_at, listId: a.list_id,
    }));
  } catch { /* ignore */ }

  return ctx;
}

// The version tag records which context builder produced the input, so stored
// AI results can be traced to their input shape.
export const CONTEXT_INPUT_VERSION = 'ctx-v1';

// Compact + minimised copy safe to send to an external provider.
export function contextForPrompt(ctx) {
  return minimizeForPrompt(ctx);
}
