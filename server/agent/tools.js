// The agent's internal tool registry.
//
// Each tool is a declarative descriptor:
//   { name, description, permission, confirm, input (schema), output (schema),
//     run(ctx, args) -> Promise<result> }
//
// `run` receives an execution context `ctx` that exposes the wired application
// use-cases and repositories (NOT the HTTP layer) plus the current user id.
// Tools call EXISTING services directly — they never re-implement verification
// and never issue HTTP requests to our own API. Deterministic results returned
// by those services are passed through unchanged.
//
// Errors thrown by a tool's run() are caught by the executor, which records the
// failure and lets the agent reason about it (it never fabricates a result).
import { PERMISSION } from './permissions.js';
import { validate } from './schemas.js';

const CLASSIFICATION = ['safe', 'review', 'remove', 'unknown'];
const DELIVERABILITY = ['deliverable', 'undeliverable', 'risky', 'unknown'];

// ---- Tool definitions ------------------------------------------------------
// ctx shape: { userId, useCases, repos:{ users, lists, contacts, history, alerts }, config }

export const TOOLS = [
  // ============================ READ =====================================
  {
    name: 'get_lists',
    description: "List the user's email lists with their latest health score. Use to find the relevant list when the user references one by name or says 'my list'.",
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', properties: {}, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx) => ctx.useCases.getLists.execute(ctx.userId),
  },
  {
    name: 'get_list',
    description: 'Get metadata + latest health for a single list by id (name, total contacts, status, health).',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], properties: { listId: { type: 'string' } }, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getListSummary.execute(ctx.userId, a.listId),
  },
  {
    name: 'get_list_health',
    description: 'Get the full health summary for a list: overall health score, deliverability/data-quality/risk/domain metrics, and safe/review/remove/unknown counts. Deterministic — do not reinterpret the numbers.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], properties: { listId: { type: 'string' } }, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx, a) => {
      const d = ctx.useCases.getListDetail.execute(ctx.userId, a.listId);
      return { list: { id: d.list.id, name: d.list.name, total: d.list.total, status: d.list.status }, summary: d.summary, delta: d.delta };
    },
  },
  {
    name: 'analyze_list',
    description: 'Produce a combined analysis of a list: health summary + campaign preflight + top risk buckets. A good first step for open-ended "analyze my list" requests.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], properties: { listId: { type: 'string' } }, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx, a) => {
      const d = ctx.useCases.getListDetail.execute(ctx.userId, a.listId);
      let preflight = null;
      try { preflight = ctx.useCases.campaignPreflight.execute(ctx.userId, a.listId); } catch { /* not verified */ }
      return {
        list: { id: d.list.id, name: d.list.name, total: d.list.total, status: d.list.status },
        summary: d.summary,
        delta: d.delta,
        preflight,
      };
    },
  },
  {
    name: 'get_health_history',
    description: 'Get historical health snapshots for a list (ascending). Use to explain WHY health changed by comparing the two most recent snapshots.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], properties: { listId: { type: 'string' } }, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx, a) => {
      const d = ctx.useCases.getListDetail.execute(ctx.userId, a.listId);
      const history = d.history || [];
      const latest = history[history.length - 1] || null;
      const previous = history[history.length - 2] || null;
      return { history, latest, previous, delta: d.delta };
    },
  },
  {
    name: 'get_contacts',
    description: 'Get a capped sample of contacts for a list. Optionally filter by classification (safe|review|remove|unknown) or deliverability (deliverable|undeliverable|risky|unknown).',
    permission: PERMISSION.READ,
    confirm: false,
    input: {
      type: 'object', required: ['listId'], additionalProperties: false,
      properties: {
        listId: { type: 'string' },
        classification: { type: ['string', 'null'], enum: [...CLASSIFICATION, null], default: null },
        deliverability: { type: ['string', 'null'], enum: [...DELIVERABILITY, null], default: null },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getFilteredContacts.execute(ctx.userId, a.listId, a),
  },
  {
    name: 'get_contacts_by_classification',
    description: 'Get contacts with a specific classification (safe|review|remove|unknown).',
    permission: PERMISSION.READ,
    confirm: false,
    input: {
      type: 'object', required: ['listId', 'classification'], additionalProperties: false,
      properties: { listId: { type: 'string' }, classification: { type: 'string', enum: CLASSIFICATION }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getFilteredContacts.execute(ctx.userId, a.listId, { classification: a.classification, limit: a.limit }),
  },
  {
    name: 'get_risky_contacts',
    description: 'Get contacts whose deterministic deliverability is "risky" (e.g. catch-all domains).',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getFilteredContacts.execute(ctx.userId, a.listId, { deliverability: 'risky', limit: a.limit }),
  },
  {
    name: 'get_unknown_contacts',
    description: 'Get contacts whose deterministic deliverability is "unknown" (mailbox could not be confirmed). These are candidates for re-verification, NOT for deletion.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getFilteredContacts.execute(ctx.userId, a.listId, { classification: 'unknown', limit: a.limit }),
  },
  {
    name: 'get_remove_contacts',
    description: 'Get contacts classified as "remove" (strong deterministic evidence they cannot receive mail).',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getFilteredContacts.execute(ctx.userId, a.listId, { classification: 'remove', limit: a.limit }),
  },
  {
    name: 'get_cleaning_plan',
    description: 'Get the deterministic cleaning plan for a list: counts of keep/review/remove and the number campaign-ready. Use before any deletion so the scope is clear.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => {
      const p = ctx.useCases.getCleaningPlan.execute(ctx.userId, a.listId);
      return { keep: p.keep, review: p.review, remove: p.remove, campaignReady: p.campaignReady };
    },
  },
  {
    name: 'run_campaign_preflight',
    description: 'Run the deterministic campaign preflight for a list: recipient buckets, recommended send list size, safe %, and a send/hold verdict.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.campaignPreflight.execute(ctx.userId, a.listId),
  },
  {
    name: 'get_verification_progress',
    description: 'Get current verification progress for a list (status, done, total).',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.getListProgress.execute(ctx.userId, a.listId),
  },
  {
    name: 'get_alerts',
    description: "Get the user's recent alerts (health drops, data-quality changes) and unread count.",
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', properties: {}, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx) => ctx.useCases.listAlerts.execute(ctx.userId),
  },
  {
    name: 'get_account_credits',
    description: 'Get the account credit balance and plan. Use before verification/re-verification to check affordability.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', properties: {}, additionalProperties: false },
    output: { type: 'object' },
    run: (ctx) => ctx.useCases.getAccountCredits.execute(ctx.userId),
  },
  {
    name: 'get_reverify_cost',
    description: 'Estimate the credit cost of verifying/re-verifying a list WITHOUT charging anything. Returns pending count, estimated credits, current balance, and affordability. Always call this before start_verification / start_reverification.',
    permission: PERMISSION.READ,
    confirm: false,
    input: {
      type: 'object', required: ['listId'], additionalProperties: false,
      properties: { listId: { type: 'string' }, reverify: { type: 'boolean', default: false } },
    },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.estimateVerificationCost.execute(ctx.userId, a.listId, a.reverify),
  },
  {
    name: 'export_list',
    description: 'Get a download URL for exporting a list (filter: all|campaign|safe|review|remove|unknown). Does not send any file itself; returns a link the UI can present.',
    permission: PERMISSION.ACTION,
    confirm: false,
    input: {
      type: 'object', required: ['listId'], additionalProperties: false,
      properties: { listId: { type: 'string' }, filter: { type: 'string', enum: ['all', 'campaign', ...CLASSIFICATION], default: 'campaign' } },
    },
    output: { type: 'object' },
    run: (ctx, a) => {
      // Validate ownership via an existing read, then return an export URL.
      ctx.useCases.getListSummary.execute(ctx.userId, a.listId);
      return { listId: a.listId, filter: a.filter, url: `/api/lists/${a.listId}/export?filter=${a.filter}&format=csv` };
    },
  },

  // =========================== ACTION ====================================
  {
    name: 'start_verification',
    description: 'Start verifying the UNVERIFIED contacts in a list. Charges credits equal to the pending count. Confirm cost with the user first when material.',
    permission: PERMISSION.ACTION,
    confirm: true,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.startListVerification.execute(ctx.userId, a.listId, false),
  },
  {
    name: 'start_reverification',
    description: 'Re-verify ALL contacts in a list. Charges credits equal to the whole list size. Always confirm the cost with the user first.',
    permission: PERMISSION.ACTION,
    confirm: true,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.startListVerification.execute(ctx.userId, a.listId, true),
  },

  // ========================= DESTRUCTIVE =================================
  {
    name: 'delete_contacts',
    description: 'Permanently delete all contacts in a list with a given classification (safe|review|remove|unknown). IRREVERSIBLE. Requires explicit user confirmation. Never call to "clean" a list without a clear, confirmed scope.',
    permission: PERMISSION.DESTRUCTIVE,
    confirm: true,
    input: {
      type: 'object', required: ['listId', 'classification'], additionalProperties: false,
      properties: { listId: { type: 'string' }, classification: { type: 'string', enum: CLASSIFICATION } },
    },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.bulkDeleteByClassification.execute(ctx.userId, a.listId, 'delete-by-classification', a.classification),
  },
  {
    name: 'delete_list',
    description: 'Permanently delete an entire list and all its contacts. IRREVERSIBLE. Requires explicit user confirmation.',
    permission: PERMISSION.DESTRUCTIVE,
    confirm: true,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.deleteList.execute(ctx.userId, a.listId),
  },
];

// ---- Registry --------------------------------------------------------------
export class ToolRegistry {
  constructor(tools = TOOLS) {
    this.map = new Map(tools.map((t) => [t.name, t]));
  }
  get(name) { return this.map.get(name) || null; }
  has(name) { return this.map.has(name); }
  list() { return [...this.map.values()]; }
  names() { return [...this.map.keys()]; }

  // Compact catalogue for the planner prompt (no run fns).
  catalogue() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      permission: t.permission,
      confirm: !!t.confirm,
      input: t.input,
    }));
  }

  validateArgs(name, args) {
    const tool = this.get(name);
    if (!tool) return { valid: false, errors: [`Unknown tool: ${name}`], value: args };
    return validate(tool.input, args || {});
  }
}

export const registry = new ToolRegistry();
