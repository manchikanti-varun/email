// The MailHealth Agent runtime. One unified operator that:
//   1) receives a user request within a conversation,
//   2) builds compact context from the authenticated user,
//   3) loops: plan -> validate -> permission-check -> (confirm gate) ->
//      execute -> observe -> reason, up to a hard iteration cap,
//   4) returns a concise final response separating verified facts from AI
//      recommendations, plus structured actions/sources and any pending
//      confirmation.
//
// AI is optional. When the agent is disabled, run() returns a graceful
// "unavailable" response and performs no work — the rest of the app is
// unaffected. When enabled without a model, it runs the deterministic
// heuristic planner (no network).
import { nanoid } from 'nanoid';
import { Planner } from './planner.js';
import { Executor, confirmationToken } from './executor.js';
import { buildContext, CONTEXT_INPUT_VERSION } from './context.js';
import { getMemory } from './memory.js';
import { agentLogger } from './logger.js';

// Per-user sliding-window rate limiter (in-process).
const rateWindow = new Map(); // userId -> [timestamps]

function rateLimited(userId, perMin) {
  const now = Date.now();
  const arr = (rateWindow.get(userId) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  rateWindow.set(userId, arr);
  return arr.length > perMin;
}

export class MailHealthAgent {
  /**
   * @param {object} deps
   * @param {object} deps.config full app config (uses config.ai)
   * @param {import('./provider.js').AiProvider} deps.provider
   * @param {import('./tools.js').ToolRegistry} deps.registry
   * @param {object} deps.audit AgentAuditRepository
   * @param {object} deps.toolContextFactory (user) -> ctx passed to tool.run
   */
  constructor({ config, provider, registry, audit, toolContextFactory }) {
    this.config = config;
    this.ai = config.ai;
    this.provider = provider;
    this.registry = registry;
    this.audit = audit;
    this.toolContextFactory = toolContextFactory;
    this.planner = new Planner({ provider, registry });
  }

  isEnabled() { return !!this.ai?.enabled; }

  /**
   * @param {object} p
   * @param {object} p.user authenticated user row (must have .id)
   * @param {string} p.message
   * @param {string} [p.listId]
   * @param {string} [p.conversationId]
   * @param {object} [p.confirm] { token, tool, args } to authorise a pending action
   * @returns {Promise<AgentResponse>}
   */
  async run({ user, message, listId, conversationId, confirm }) {
    const generatedAt = new Date().toISOString();
    const convId = conversationId || nanoid();

    if (!this.isEnabled()) {
      return this._response({
        conversationId: convId,
        message: 'MailHealth AI is currently disabled. All verification and list features work normally without it. An administrator can enable it by setting AI_ENABLED=true.',
        generatedAt, model: 'disabled', meta: { mode: 'disabled' },
      });
    }

    if ((!message || !String(message).trim()) && !confirm) {
      return this._response({ conversationId: convId, message: 'Ask me about your email lists — for example "Is my list ready to send?" or "Why did my health drop?"', generatedAt, model: 'idle', meta: { mode: 'idle' } });
    }

    if (rateLimited(user.id, this.ai.rateLimitPerMin || 20)) {
      return this._response({ conversationId: convId, message: 'You are sending requests too quickly. Please wait a moment and try again.', generatedAt, model: 'rate-limited', meta: { mode: 'rate-limited' } });
    }

    const memory = getMemory(user.id, convId);
    memory.lastRequest = message;
    if (listId) memory.currentListId = listId;

    const toolCtx = this.toolContextFactory(user);
    const executor = new Executor({ registry: this.registry, audit: this.audit, user, conversationId: convId, userRequest: message });

    const startedAt = Date.now();
    const actions = [];
    const sources = [];
    let totalCost = 0;
    let usedModel = this.provider.hasModel() ? this.ai.model : 'heuristic';
    let plannerMode = null;

    // ---- Confirmation path: user is authorising a previously proposed op ---
    if (confirm && confirm.token && confirm.tool) {
      const expected = confirmationToken(confirm.tool, confirm.args || memory.pendingConfirmation?.args || {});
      const pending = memory.pendingConfirmation;
      const argsToUse = confirm.args || pending?.args || {};
      if (expected !== confirm.token || !pending || pending.tool !== confirm.tool) {
        return this._response({ conversationId: convId, message: 'That confirmation is no longer valid. Please re-issue the request so I can re-check the current numbers before acting.', generatedAt, model: usedModel, meta: { mode: 'confirmation-invalid' } });
      }
      const outcome = await executor.run(confirm.tool, argsToUse, toolCtx, { confirmed: true });
      actions.push(publicAction(outcome));
      memory.recordToolResult(confirm.tool, argsToUse, outcome.result);
      memory.pendingConfirmation = null;
      const summary = this._summariseConfirmedAction(confirm.tool, argsToUse, outcome, toolCtx);
      memory.addTurn('user', message);
      memory.addTurn('assistant', summary);
      return this._response({
        conversationId: convId, message: summary, actions, sources,
        generatedAt, latencyMs: Date.now() - startedAt, model: usedModel,
        meta: { mode: 'confirmed-action', tool: confirm.tool },
      });
    }

    // ---- Main reasoning loop ----------------------------------------------
    const context = buildContext({ userId: user.id, useCases: toolCtx.useCases, hintListId: listId, memory });
    const observations = [];
    const maxIter = Math.max(1, this.ai.maxIterations || 10);
    let finalMessage = null;
    let pendingConfirmation = null;
    let iterations = 0;

    while (iterations < maxIter) {
      iterations++;
      const { decision, meta } = await this.planner.next({
        context,
        transcript: memory.turns,
        observations,
        userMessage: message,
      });
      plannerMode = meta.mode;
      usedModel = meta.model || usedModel;
      totalCost += meta.estimatedCost || 0;

      if (decision.action === 'final') {
        finalMessage = decision.message;
        // The heuristic planner may attach a confirmation proposal to a final.
        if (decision.proposeConfirm) {
          const p = decision.proposeConfirm;
          memory.pendingConfirmation = { tool: p.tool, args: p.args, summary: p.summary };
          pendingConfirmation = {
            tool: p.tool, summary: p.summary,
            token: confirmationToken(p.tool, p.args), args: p.args,
            permission: this.registry.get(p.tool)?.permission || 'action',
          };
        }
        break;
      }

      // Tool step.
      const outcome = await executor.run(decision.tool, decision.args, toolCtx, { confirmed: false });
      observations.push({ tool: decision.tool, status: outcome.status, result: outcome.result, error: outcome.error });
      actions.push(publicAction(outcome));
      if (outcome.status === 'ok') {
        memory.recordToolResult(decision.tool, decision.args, outcome.result);
        addSource(sources, decision.tool, outcome.result);
      }

      // A tool that needs confirmation halts the loop and asks the user.
      if (outcome.needsConfirmation) {
        memory.pendingConfirmation = { tool: outcome.confirmation.tool, args: outcome.confirmation.args, summary: describeConfirmation(outcome.confirmation) };
        pendingConfirmation = {
          tool: outcome.confirmation.tool,
          args: outcome.confirmation.args,
          token: outcome.confirmation.token,
          summary: describeConfirmation(outcome.confirmation),
          permission: this.registry.get(outcome.confirmation.tool)?.permission || 'destructive',
        };
        finalMessage = finalMessage || `This action needs your confirmation: ${pendingConfirmation.summary}. It cannot be undone.`;
        break;
      }
    }

    if (finalMessage == null) {
      finalMessage = `I gathered information across ${iterations} steps but reached the ${maxIter}-step limit before finishing. ` +
        (observations.length ? `Here's what I found so far: ${observations.map((o) => o.tool).join(', ')}. ` : '') +
        'Try narrowing the request (for example, name the specific list).';
    }

    memory.addTurn('user', message);
    memory.addTurn('assistant', finalMessage);

    agentLogger.info('agent_run', {
      userId: user.id, conversationId: convId, iterations, mode: plannerMode,
      tools: observations.map((o) => o.tool), latencyMs: Date.now() - startedAt,
      estimatedCost: totalCost,
    });

    return this._response({
      conversationId: convId,
      message: finalMessage,
      actions, sources, pendingConfirmation,
      generatedAt, latencyMs: Date.now() - startedAt,
      model: usedModel,
      meta: { mode: plannerMode, iterations, estimatedCost: totalCost },
    });
  }

  _summariseConfirmedAction(tool, args, outcome, toolCtx) {
    if (outcome.status !== 'ok') {
      return `I attempted "${tool}" but it did not complete: ${outcome.error}. No further changes were made.`;
    }
    if (tool === 'delete_contacts') {
      let remaining = null;
      try { remaining = toolCtx.useCases.getCleaningPlan.execute(toolCtx.userId, args.listId); } catch { /* ignore */ }
      const deleted = outcome.result?.deleted ?? 0;
      return `Done — permanently removed ${deleted} "${args.classification}" contacts.` +
        (remaining ? ` The list now has ${remaining.keep} keep, ${remaining.review} review, ${remaining.remove} remove.` : '');
    }
    if (tool === 'delete_list') return 'Done — the list and all its contacts were permanently deleted.';
    if (tool === 'start_reverification' || tool === 'start_verification') {
      return `Started ${tool === 'start_reverification' ? 're-verification' : 'verification'} of ${outcome.result?.total ?? 0} contacts. I'll reflect the results once it finishes.`;
    }
    return `Done — ${tool} completed.`;
  }

  _response({ conversationId, message, actions = [], sources = [], pendingConfirmation = null, generatedAt, latencyMs = 0, model, meta = {} }) {
    // Every AI result carries provenance metadata (stored/returned per spec).
    return {
      conversationId,
      message,
      actions,
      sources,
      pendingConfirmation: pendingConfirmation ? { ...pendingConfirmation } : null,
      // provenance
      model,
      modelVersion: model,
      generatedAt,
      confidence: meta.mode === 'llm' ? 'medium' : (meta.mode && meta.mode.startsWith('heuristic') ? 'high' : 'unknown'),
      inputVersion: CONTEXT_INPUT_VERSION,
      latency: latencyMs,
      estimatedCost: meta.estimatedCost || 0,
      meta,
    };
  }
}

// ---- helpers ---------------------------------------------------------------
function publicAction(outcome) {
  return {
    tool: outcome.tool,
    permission: outcome.permission,
    status: outcome.status,
    durationMs: outcome.durationMs,
    // Do not echo full results into actions; the message carries the summary.
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.needsConfirmation ? { needsConfirmation: true } : {}),
  };
}

function addSource(sources, tool, result) {
  // Sources mark which deterministic tool provided a verified fact.
  const label = {
    get_list_health: 'List health (deterministic)',
    analyze_list: 'List analysis (deterministic)',
    run_campaign_preflight: 'Campaign preflight (deterministic)',
    get_health_history: 'Health history (deterministic)',
    get_cleaning_plan: 'Cleaning plan (deterministic)',
    get_reverify_cost: 'Credit estimate',
  }[tool];
  if (label && !sources.some((s) => s.tool === tool)) sources.push({ tool, label, kind: 'verified' });
}

function describeConfirmation(c) {
  if (c.tool === 'delete_contacts') return `Remove contacts classified as "${c.args.classification}"`;
  if (c.tool === 'delete_list') return 'Delete this entire list';
  if (c.tool === 'start_reverification') return 'Re-verify all contacts (spends credits)';
  if (c.tool === 'start_verification') return 'Verify pending contacts (spends credits)';
  return `Run ${c.tool}`;
}
