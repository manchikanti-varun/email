// Shared test doubles for the agent test-suite. Everything is in-memory and
// offline — no network, no SQLite. The fakes reproduce just enough of the real
// use-case return shapes for the agent to reason over.

export function makeFakeAudit() {
  const entries = [];
  return {
    entries,
    record(e) { entries.push({ ...e }); return 'aud_' + entries.length; },
    findByUser() { return entries.slice().reverse(); },
    findByConversation(_u, c) { return entries.filter((x) => x.conversationId === c); },
  };
}

// A configurable fake set of use-cases matching the real method signatures the
// tools call. `data` lets each test tailor lists/contacts/credits.
export function makeFakeUseCases(data = {}) {
  const state = {
    credits: data.credits ?? 1000,
    plan: data.plan ?? 'free',
    lists: data.lists ?? [],           // [{ id, name, total, status, health }]
    contacts: data.contacts ?? {},     // { [listId]: [{ email, deliverability, classification, confidence, score, riskSignals }] }
    history: data.history ?? {},       // { [listId]: [snapshots] }
    alerts: data.alerts ?? [],
    started: [],                        // record of verification starts
    deleted: [],                        // record of deletions
  };

  const findList = (userId, listId) => state.lists.find((l) => l.id === listId);
  const notFound = () => { const e = new Error('List not found'); e.status = 404; throw e; };

  const uc = {
    getAccountCredits: { execute: () => ({ credits: state.credits, plan: state.plan }) },
    getLists: { execute: () => ({ lists: state.lists.map((l) => ({ ...l })) }) },
    getListSummary: {
      execute: (u, id) => { const l = findList(u, id); if (!l) notFound(); return { ...l }; },
    },
    getListDetail: {
      execute: (u, id) => {
        const l = findList(u, id); if (!l) notFound();
        const contacts = state.contacts[id] || [];
        const counts = { safe: 0, review: 0, remove: 0, unknown: 0 };
        for (const c of contacts) counts[c.classification] = (counts[c.classification] || 0) + 1;
        const hist = state.history[id] || [];
        const delta = hist.length >= 2 ? Math.round((hist[hist.length - 1].health - hist[hist.length - 2].health) * 10) / 10 : null;
        return {
          list: { ...l },
          summary: { total: contacts.length, counts, metrics: l.metrics || { deliverability: 80, dataQuality: 90, risk: 85, domainHealth: 88 }, health: l.health ?? 0 },
          contacts, history: hist, delta,
        };
      },
    },
    getCleaningPlan: {
      execute: (u, id) => {
        const l = findList(u, id); if (!l) notFound();
        const contacts = state.contacts[id] || [];
        const plan = { keep: 0, review: 0, remove: 0 };
        for (const c of contacts) {
          if (c.classification === 'safe') plan.keep++;
          else if (c.classification === 'remove') plan.remove++;
          else plan.review++;
        }
        return { ...plan, campaignReady: plan.keep };
      },
    },
    campaignPreflight: {
      execute: (u, id) => {
        const l = findList(u, id); if (!l) notFound();
        const contacts = state.contacts[id] || [];
        if (!contacts.length) { const e = new Error('Not verified'); e.status = 400; throw e; }
        const safe = contacts.filter((c) => c.classification === 'safe').length;
        const total = contacts.length;
        const safePct = total ? Math.round((safe / total) * 100) : 0;
        return { listName: l.name, recipients: total, buckets: { safe, review: total - safe, catchAll: 0, invalid: 0, disposable: 0, unknown: 0 }, recommendedSendList: safe, safePct, verdict: safePct >= 85 ? 'Good to send.' : 'Send with caution.' };
      },
    },
    getListProgress: { execute: (u, id) => { const l = findList(u, id); if (!l) notFound(); return { status: l.status, done: 0, total: l.total }; } },
    listAlerts: { execute: () => ({ alerts: state.alerts, unread: state.alerts.filter((a) => !a.read).length }) },
    getFilteredContacts: {
      execute: (u, id, opts = {}) => {
        const l = findList(u, id); if (!l) notFound();
        let rows = state.contacts[id] || [];
        if (opts.classification) rows = rows.filter((c) => c.classification === opts.classification);
        if (opts.deliverability) rows = rows.filter((c) => c.deliverability === opts.deliverability);
        return { listId: id, listName: l.name, matched: rows.length, returned: rows.length, contacts: rows };
      },
    },
    estimateVerificationCost: {
      execute: (u, id, reverify) => {
        const l = findList(u, id); if (!l) notFound();
        const contacts = state.contacts[id] || [];
        const pending = reverify ? l.total : contacts.filter((c) => !c.verified).length || l.total;
        return { listId: id, listName: l.name, reverify: !!reverify, pending, estimatedCredits: pending, availableCredits: state.credits, affordable: state.credits >= pending, shortfall: Math.max(0, pending - state.credits) };
      },
    },
    startListVerification: {
      execute: (u, id, reverify) => {
        const l = findList(u, id); if (!l) notFound();
        const total = reverify ? l.total : l.total;
        if (state.credits < total) { const e = new Error('Insufficient credits'); e.status = 402; throw e; }
        state.credits -= total;
        state.started.push({ id, reverify: !!reverify, total });
        return { started: true, jobId: 'job_' + state.started.length, total };
      },
    },
    bulkDeleteByClassification: {
      execute: (u, id, action, classification) => {
        const l = findList(u, id); if (!l) notFound();
        const rows = state.contacts[id] || [];
        const deleted = rows.filter((c) => c.classification === classification).length;
        state.contacts[id] = rows.filter((c) => c.classification !== classification);
        state.deleted.push({ id, classification, deleted });
        return { ok: true, deleted };
      },
    },
    deleteList: {
      execute: (u, id) => { const idx = state.lists.findIndex((l) => l.id === id); if (idx === -1) notFound(); state.lists.splice(idx, 1); return { ok: true }; },
    },
  };

  return { uc, state };
}

export const FAKE_USER = { id: 'user_test', email: 'test@example.com', credits: 1000, plan: 'free' };

export const AI_CONFIG = {
  enabled: true, provider: '', apiKey: '', model: '',
  timeoutMs: 5000, maxRetries: 1, maxIterations: 10, rateLimitPerMin: 1000,
  costPer1kInput: 0, costPer1kOutput: 0, confirmSpendThreshold: 50,
};
