// The planner decides the agent's next step: call a tool, or give a final
// answer. Two modes:
//
//   LLM mode      - when a real model is configured (provider.hasModel()). The
//                   model returns a structured JSON decision, validated against
//                   PLANNER_DECISION_SCHEMA.
//   Heuristic mode- when no model is configured (AI enabled but no key, or AI
//                   disabled path used by tests). Deterministic intent routing
//                   over the same tool set, so the agent is fully functional
//                   and testable without any network access.
//
// Either way the executor enforces permissions/confirmation/credits — the
// planner only proposes.
import { PLANNER_DECISION_SCHEMA, validate } from './schemas.js';
import { SYSTEM_PROMPT, buildPlannerMessages } from './prompts.js';
import { contextForPrompt } from './context.js';

export class Planner {
  constructor({ provider, registry }) {
    this.provider = provider;
    this.registry = registry;
  }

  usesLlm() { return this.provider && this.provider.hasModel(); }

  // -> { decision, meta } where decision matches PLANNER_DECISION_SCHEMA.
  async next({ context, transcript, observations, userMessage }) {
    if (this.usesLlm()) {
      const res = await this.provider.completeJson({
        system: SYSTEM_PROMPT,
        messages: buildPlannerMessages({
          contextSummary: contextForPrompt(context),
          catalogue: this.registry.catalogue(),
          transcript,
          observations,
          userMessage,
        }),
      });
      if (res.ok && res.json) {
        const { valid, value } = validate(PLANNER_DECISION_SCHEMA, res.json);
        if (valid && (value.action === 'final' || (value.action === 'tool' && this.registry.has(value.tool)))) {
          return { decision: value, meta: { mode: 'llm', model: res.model, usage: res.usage, latencyMs: res.latencyMs, estimatedCost: res.estimatedCost } };
        }
      }
      // LLM unusable this turn — degrade gracefully to heuristic.
      return { decision: this._heuristic({ context, observations, userMessage }), meta: { mode: 'heuristic-fallback', model: res.model, error: res.error, latencyMs: res.latencyMs || 0, estimatedCost: res.estimatedCost || 0, usage: res.usage || {} } };
    }
    return { decision: this._heuristic({ context, observations, userMessage }), meta: { mode: 'heuristic', model: 'heuristic', latencyMs: 0, estimatedCost: 0, usage: {} } };
  }

  // -------- Deterministic heuristic planner --------------------------------
  _heuristic({ context, observations, userMessage }) {
    const msg = (userMessage || '').toLowerCase();
    const seen = new Set(observations.map((o) => o.tool));
    const listId = this._resolveListId(context, msg);
    const has = (t) => seen.has(t);
    const result = (t) => observations.find((o) => o.tool === t && o.status === 'ok')?.result;

    // No list to work with and user references one -> discover lists first.
    if (!listId) {
      if (!has('get_lists')) return tool('get_lists', {}, 'Finding your lists.');
      const lists = result('get_lists')?.lists || context.lists || [];
      if (lists.length === 0) return final('You have no lists yet. Upload a CSV/XLSX from the Dashboard, and I can analyze it.');
      if (lists.length > 1) {
        return final('You have multiple lists: ' + lists.map((l) => `"${l.name}"`).join(', ') +
          '. Which one should I look at?');
      }
    }

    const id = listId || (result('get_lists')?.lists?.[0]?.id) || context.lists?.[0]?.id;

    // Intent: cleaning / deletion (destructive) -> plan first, never auto-delete.
    if (/\b(clean|delete|remove|purge)\b/.test(msg)) {
      if (!has('get_cleaning_plan')) return tool('get_cleaning_plan', { listId: id }, 'Building the cleaning plan.');
      const plan = result('get_cleaning_plan') || {};
      return final(
        `Cleaning plan for this list: ${plan.remove ?? 0} to remove, ${plan.review ?? 0} to review, ${plan.keep ?? 0} safe to keep.\n\n` +
        `I can permanently delete the ${plan.remove ?? 0} "Remove" contacts. This cannot be undone — confirm to proceed.`,
        { proposeConfirm: { tool: 'delete_contacts', args: { listId: id, classification: 'remove' }, summary: `Remove ${plan.remove ?? 0} contacts classified as Remove` } }
      );
    }

    // Intent: re-verification / verification (credit-spending).
    if (/\b(re-?verify|reverif|verify again|check again)\b/.test(msg)) {
      if (!has('get_reverify_cost')) return tool('get_reverify_cost', { listId: id, reverify: true }, 'Estimating the re-verification cost.');
      const cost = result('get_reverify_cost') || {};
      if (!cost.affordable) return final(`Re-verifying this list would cost ${cost.estimatedCredits} credits but you have ${cost.availableCredits}. You're short ${cost.shortfall}. I've stopped so no credits are spent.`);
      return final(
        `Re-verifying this list will check ${cost.pending} contacts and cost ${cost.estimatedCredits} credits (you have ${cost.availableCredits}). Confirm to proceed.`,
        { proposeConfirm: { tool: 'start_reverification', args: { listId: id }, summary: `Re-verify ${cost.pending} contacts for ${cost.estimatedCredits} credits` } }
      );
    }

    // Intent: readiness / preflight.
    if (/\b(ready to send|preflight|can i send|safe to send|good to send)\b/.test(msg)) {
      if (!has('get_list_health')) return tool('get_list_health', { listId: id }, 'Checking list health.');
      if (!has('run_campaign_preflight')) return tool('run_campaign_preflight', { listId: id }, 'Running campaign preflight.');
      return final(this._readinessAnswer(result('get_list_health'), result('run_campaign_preflight')));
    }

    // Intent: why did health change?
    if (/\b(why|drop|fell|fall|change|decrease|down)\b/.test(msg) && /\bhealth\b/.test(msg)) {
      if (!has('get_health_history')) return tool('get_health_history', { listId: id }, 'Loading health history.');
      return final(this._healthChangeAnswer(result('get_health_history')));
    }

    // Intent: risky/unknown contacts.
    if (/\brisky\b/.test(msg)) {
      if (!has('get_risky_contacts')) return tool('get_risky_contacts', { listId: id, limit: 50 }, 'Finding risky contacts.');
      const r = result('get_risky_contacts') || {};
      return final(`Found ${r.matched ?? 0} risky contacts (deliverability "risky", typically catch-all domains). These need review, not automatic removal.`);
    }
    if (/\bunknown\b|\bneed(s)? re-?verification\b/.test(msg)) {
      if (!has('get_unknown_contacts')) return tool('get_unknown_contacts', { listId: id, limit: 50 }, 'Finding unknown contacts.');
      const r = result('get_unknown_contacts') || {};
      return final(`Found ${r.matched ?? 0} contacts with "unknown" deliverability — the mailbox could not be confirmed. These are candidates for re-verification, not deletion.`);
    }

    // Default: analyze the list.
    if (!has('analyze_list')) return tool('analyze_list', { listId: id }, 'Analyzing the list.');
    return final(this._analysisAnswer(result('analyze_list')));
  }

  _resolveListId(context, msg) {
    if (context.relevantListId) return context.relevantListId;
    const lists = context.lists || [];
    const named = lists.find((l) => l.name && msg.includes(l.name.toLowerCase()));
    if (named) return named.id;
    // Keyword-based single match (e.g. "customer", "marketing").
    const kw = lists.find((l) => l.name && l.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && msg.includes(w)));
    return kw ? kw.id : null;
  }

  _readinessAnswer(health, pre) {
    if (!pre) return 'This list has no verification results yet, so I can\'t assess send-readiness. Run verification first.';
    const h = health?.summary?.health;
    const parts = [];
    parts.push(`Verified facts: ${pre.recipients} recipients, ${pre.buckets.safe} safe, ${pre.buckets.review} review, ${pre.buckets.invalid} invalid, ${pre.buckets.catchAll} catch-all, ${pre.buckets.unknown} unknown. Safe share ${pre.safePct}%.` + (h != null ? ` List health ${h}/100.` : ''));
    parts.push(`Recommendation: ${pre.verdict} Recommended send list: ${pre.recommendedSendList} contacts.`);
    return parts.join('\n\n');
  }

  _healthChangeAnswer(hist) {
    if (!hist || !hist.latest) return 'No health history yet — I need at least one verification snapshot to explain a change.';
    if (!hist.previous) return `Only one health snapshot exists (${hist.latest.health}/100), so there's no prior point to compare against yet.`;
    const cur = hist.latest, prev = hist.previous;
    const d = Math.round((cur.health - prev.health) * 10) / 10;
    const dir = d >= 0 ? 'up' : 'down';
    const changes = [];
    if (cur.counts && prev.counts) {
      for (const k of ['remove', 'review', 'unknown', 'safe']) {
        const diff = (cur.counts[k] || 0) - (prev.counts[k] || 0);
        if (diff !== 0) changes.push(`${diff > 0 ? '+' : ''}${diff} ${k}`);
      }
    }
    return `Verified facts: list health is ${cur.health}/100, ${dir} from ${prev.health}/100 in the previous snapshot (change ${d >= 0 ? '+' : ''}${d}).` +
      (changes.length ? ` Bucket changes: ${changes.join(', ')}.` : '') +
      `\n\nRecommendation: ${d < 0 ? 'the drop is driven by the bucket changes above; review the newly-flagged contacts before your next send.' : 'health improved; no action needed.'}`;
  }

  _analysisAnswer(a) {
    if (!a) return 'I could not load that list.';
    const s = a.summary || {};
    const c = s.counts || {};
    const lines = [`Verified facts for "${a.list?.name}": health ${s.health ?? '—'}/100 across ${a.list?.total ?? 0} contacts. Keep ${c.safe ?? 0}, review ${c.review ?? 0}, remove ${c.remove ?? 0}, unknown ${c.unknown ?? 0}.`];
    if (a.preflight) lines.push(`Preflight: ${a.preflight.safePct}% safe. ${a.preflight.verdict}`);
    else lines.push('This list is not fully verified yet, so preflight is unavailable.');
    lines.push('Recommendation: ' + ((c.remove ?? 0) > 0
      ? `remove the ${c.remove} invalid contacts and review the ${c.review} flagged ones before sending.`
      : 'the list looks clean; you can proceed.'));
    return lines.join('\n\n');
  }
}

function tool(name, args, thought) { return { action: 'tool', tool: name, args, thought: thought || '', message: '' }; }
function final(message, extra = {}) { return { action: 'final', tool: null, args: {}, thought: '', message, ...extra }; }
