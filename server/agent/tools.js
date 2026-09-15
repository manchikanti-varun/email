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

  // ==================== AI INTELLIGENCE (READ) ===========================
  // These tools delegate to the AI Intelligence use-cases, which fetch real
  // deterministic data and return interpretation (FACT/INFERENCE/PREDICTION/
  // RECOMMENDATION + confidence). They never fabricate verification results.
  {
    name: 'get_campaign_risk',
    description: 'Assess whether a campaign is safe to send: risk level (LOW/MEDIUM/HIGH), risk score, safe/review/remove/unknown recipients, recommended send count, key risks and reasoning. Interprets deterministic data; never claims guaranteed inbox placement.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiCampaignRisk.execute(ctx.userId, a.listId),
  },
  {
    name: 'analyze_list_health',
    description: 'AI analysis of a list\'s health: summary, trend (IMPROVING/STABLE/DECLINING), major contributors, positive/negative signals, and recommendations. Explains WHY, not just numbers.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiHealthAnalysis.execute(ctx.userId, a.listId),
  },
  {
    name: 'predict_list_health',
    description: 'Forecast a list\'s future health (30/60/90 days) from historical snapshots, as a RANGE with confidence. Returns "insufficient historical data" when there are too few snapshots. A forecast, never a fact.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiHealthPrediction.execute(ctx.userId, a.listId),
  },
  {
    name: 'detect_list_anomalies',
    description: 'Detect sudden shifts (e.g. an unknown/remove/catch-all spike) between the two most recent verification snapshots for a list.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiListAnomalies.execute(ctx.userId, a.listId),
  },
  {
    name: 'analyze_domain',
    description: 'Rank the domains in a list by problem contribution, with per-domain deliverable/unknown/risky/disposable/catch-all breakdown and a recommended action. Use to answer "which domains are causing most of my list problems?".',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, minContacts: { type: 'integer', minimum: 1, default: 1 } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiDomainIntelligence.execute(ctx.userId, a.listId, { limit: a.limit, minContacts: a.minContacts }),
  },
  {
    name: 'get_smart_cleaning',
    description: 'Prioritise cleaning: deterministic keep/review/remove buckets plus a HIGH/MEDIUM/LOW priority ranking of review/unknown contacts to examine first. AI never deletes; use delete_contacts (confirmed) to act.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiSmartCleaning.execute(ctx.userId, a.listId),
  },
  {
    name: 'prioritize_reverification',
    description: 'Rank a list\'s contacts by expected information gain per credit (URGENT/HIGH/MEDIUM/LOW) using verification age, confidence, greylist/catch-all status. Use before re-verifying to spend credits well.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiReverificationPriority.execute(ctx.userId, a.listId, { limit: a.limit }),
  },
  {
    name: 'optimize_verification_credits',
    description: 'Recommend how to spend verification credits efficiently across a list: which contacts to verify first, how many credits are required, and estimated credits saved by deferring low-value contacts.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiCreditOptimization.execute(ctx.userId, a.listId),
  },
  {
    name: 'generate_email_explanation',
    description: 'Explain one contact\'s verification result in plain language (mode "simple") or for developers (mode "technical"). Adds no technical fact not present in the deterministic evidence.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId', 'email'], additionalProperties: false, properties: { listId: { type: 'string' }, email: { type: 'string' }, mode: { type: 'string', enum: ['simple', 'technical'], default: 'simple' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiEmailExplanation.execute(ctx.userId, a.listId, { email: a.email, mode: a.mode }),
  },
  {
    name: 'generate_business_insights',
    description: 'Turn a list\'s verification data into business-facing insights: list quality, contacts needing attention, worst domains, and recommendations. Avoids unsupported claims about revenue/open-rate/inbox placement.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiBusinessInsights.execute(ctx.userId, a.listId),
  },
  {
    name: 'investigate_verification_issue',
    description: 'Investigate WHY verification results changed (e.g. "why are so many emails unknown?"). Composes anomaly, incident and domain analysis into a Finding / Evidence / Possible Cause / Confidence / Recommended Action report. Distinguishes infrastructure issues from list deterioration; never asserts an unsupported cause.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId'], additionalProperties: false, properties: { listId: { type: 'string' }, question: { type: ['string', 'null'], default: null } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiInvestigate.execute(ctx.userId, a.listId, { question: a.question }),
  },
  {
    name: 'detect_incidents',
    description: 'Detect verification infrastructure incidents (SMTP/DNS/worker problems) vs genuine list deterioration. With a listId scopes to one list; without, scans all the user\'s lists and reports the most severe signal. Never claims an outage without evidence.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', additionalProperties: false, properties: { listId: { type: ['string', 'null'], default: null } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiIncidents.execute(ctx.userId, a.listId || null),
  },
  {
    name: 'analyze_benchmark',
    description: 'Analyse a benchmark run (a labelled dataset scored by the engine): accuracy, precision, recall, false-positive/negative rates, agreement, and where the engine most disagrees with ground truth. Read-only; never changes verdicts.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['benchmark'], additionalProperties: true, properties: { benchmark: { type: 'object' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiBenchmarkAnalysis.execute(ctx.userId, { benchmark: a.benchmark }),
  },
  {
    name: 'calibrate_confidence',
    description: 'Estimate how RELIABLE the deterministic verdict is for one contact in a list (calibrated P(correct verdict | evidence)): a HIGH/MEDIUM/LOW level, the contributing evidence, and any rule-vs-ML disagreement flagged for review. Never changes the verdict. If no ML model is trained it honestly reports the deterministic confidence.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', required: ['listId', 'email'], additionalProperties: false, properties: { listId: { type: 'string' }, email: { type: 'string' } } },
    output: { type: 'object' },
    run: (ctx, a) => ctx.useCases.aiConfidenceCalibration.execute(ctx.userId, a.listId, { email: a.email }),
  },
  {
    name: 'get_calibration_status',
    description: 'Report whether the ML confidence-calibration model is available and its version. Read-only.',
    permission: PERMISSION.READ,
    confirm: false,
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => (ctx.config?.calibrationStatus || { available: false, reason: 'no-model' }),
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
