// Executes a single tool call safely: validates arguments, enforces
// permissions, enforces the destructive-confirmation gate, records an audit
// entry, and returns a structured result. It NEVER fabricates a result — a
// failure is reported as a failure so the planner can reason about it.
import crypto from 'node:crypto';
import { isAllowed, requiresConfirmation } from './permissions.js';
import { redact } from './guardrails.js';
import { agentLogger } from './logger.js';

// A confirmation token binds a pending destructive/action call to its exact
// arguments, so a user's "confirm" can't be replayed against different args.
export function confirmationToken(tool, args) {
  return crypto.createHash('sha256')
    .update(tool + '|' + JSON.stringify(args || {}))
    .digest('hex')
    .slice(0, 24);
}

export class Executor {
  constructor({ registry, audit, user, conversationId, userRequest }) {
    this.registry = registry;
    this.audit = audit;
    this.user = user;
    this.conversationId = conversationId;
    this.userRequest = userRequest;
  }

  /**
   * @param {string} name
   * @param {object} args
   * @param {object} ctx execution context passed to the tool's run()
   * @param {object} opts { confirmed:boolean }
   * @returns {Promise<{status, tool, args, result?, error?, needsConfirmation?, confirmation?}>}
   */
  async run(name, rawArgs, ctx, opts = {}) {
    const started = Date.now();
    const tool = this.registry.get(name);

    if (!tool) {
      return this._record({ name, args: rawArgs, permission: 'read', status: 'error', error: `Unknown tool: ${name}`, started, confirmed: false });
    }

    // 1) Permission check.
    if (!isAllowed(this.user, tool)) {
      return this._record({ name, args: rawArgs, permission: tool.permission, status: 'denied', error: 'Permission denied for this tool', started, confirmed: false });
    }

    // 2) Argument validation.
    const { valid, errors, value } = this.registry.validateArgs(name, rawArgs);
    if (!valid) {
      return this._record({ name, args: rawArgs, permission: tool.permission, status: 'invalid_args', error: errors.join('; '), started, confirmed: false });
    }

    // 3) Confirmation gate for destructive/confirm-required tools.
    if (requiresConfirmation(tool) && !opts.confirmed) {
      const token = confirmationToken(name, value);
      agentLogger.info('tool_needs_confirmation', { tool: name, permission: tool.permission });
      return this._record({
        name, args: value, permission: tool.permission, status: 'awaiting_confirmation',
        started, confirmed: false,
        extra: { needsConfirmation: true, confirmation: { tool: name, args: value, token } },
      });
    }

    // 4) Execute the real service. Failures are surfaced, never faked.
    try {
      const result = await tool.run(ctx, value);
      return this._record({ name, args: value, permission: tool.permission, status: 'ok', result, started, confirmed: !!opts.confirmed });
    } catch (e) {
      const status = e.status ? `error_${e.status}` : 'error';
      agentLogger.warn('tool_failed', { tool: name, error: e.message, status: e.status });
      return this._record({ name, args: value, permission: tool.permission, status, error: e.message || 'Tool failed', started, confirmed: !!opts.confirmed });
    }
  }

  _record({ name, args, permission, status, result, error, started, confirmed, extra = {} }) {
    const durationMs = Date.now() - started;
    // Audit log — arguments are redacted of any secret-looking keys (there
    // shouldn't be any, but defence in depth).
    try {
      this.audit?.record({
        userId: this.user.id,
        conversationId: this.conversationId,
        userRequest: this.userRequest,
        toolName: name,
        toolArgs: redact(args),
        permission,
        status,
        confirmed: !!confirmed,
        durationMs,
        error: error || null,
      });
    } catch (e) {
      agentLogger.error('audit_write_failed', { error: e.message });
    }
    return { tool: name, args, permission, status, result, error, durationMs, ...extra };
  }
}
