// Thin application use-cases that fill small read/query gaps the AI agent's
// tools need. They REUSE the existing repositories and never duplicate any
// verification logic — the deterministic engine remains the source of truth.
// Each is a plain class with an execute() that throws AppError on failure,
// matching the existing use-case convention.
import { AppError } from './errors.js';

// ---- Account credits (read-only) ------------------------------------------
export class GetAccountCredits {
  constructor({ users }) { this.users = users; }
  execute(userId) {
    const u = this.users.findById(userId);
    if (!u) throw new AppError(404, 'User not found');
    return { credits: u.credits, plan: u.plan };
  }
}

// ---- Single list metadata + latest health (read-only) ---------------------
export class GetListSummary {
  constructor({ lists }) { this.lists = lists; }
  execute(userId, listId) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');
    return {
      id: list.id,
      name: list.name,
      total: list.total,
      duplicates: list.duplicates,
      status: list.status,
      created_at: list.created_at,
      health: this.lists.latestHealth(list.id),
    };
  }
}

// ---- Estimate verification cost WITHOUT charging (read-only) --------------
// Credit protection: lets the agent tell the user the expected cost and check
// affordability before ever calling the credit-charging verification path.
export class EstimateVerificationCost {
  constructor({ lists, contacts, users }) {
    this.lists = lists; this.contacts = contacts; this.users = users;
  }
  execute(userId, listId, reverify = false) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');
    const user = this.users.findById(userId);
    const pending = this.contacts.countPending(list.id, !!reverify);
    const credits = user?.credits ?? 0;
    return {
      listId: list.id,
      listName: list.name,
      reverify: !!reverify,
      pending,                       // contacts that would be verified
      estimatedCredits: pending,     // 1 credit per contact
      availableCredits: credits,
      affordable: credits >= pending,
      shortfall: Math.max(0, pending - credits),
    };
  }
}

// ---- Contacts filtered by classification OR deliverability (read-only) ----
// classification ∈ safe|review|remove|unknown
// deliverability ∈ deliverable|undeliverable|risky|unknown
// Returns a capped, PII-minimal projection (email + verdict fields only).
export class GetFilteredContacts {
  constructor({ lists, contacts }) { this.lists = lists; this.contacts = contacts; }

  execute(userId, listId, { classification = null, deliverability = null, limit = 50 } = {}) {
    const list = this.lists.findByIdForUser(listId, userId);
    if (!list) throw new AppError(404, 'List not found');

    let rows = this.contacts.findByList(list.id);
    if (classification) rows = rows.filter((c) => c.classification === classification);
    if (deliverability) rows = rows.filter((c) => (c.deliverability || c.status) === deliverability);

    const matched = rows.length;
    const capped = rows.slice(0, Math.max(1, Math.min(500, limit)));
    return {
      listId: list.id,
      listName: list.name,
      matched,
      returned: capped.length,
      contacts: capped.map((c) => ({
        email: c.email,
        deliverability: c.deliverability || c.status || 'unknown',
        confidence: c.confidence || 'unknown',
        classification: c.classification || 'unknown',
        recommendedAction: c.recommendedAction || c.recommended_action || null,
        score: c.deliverabilityScore ?? c.score ?? null,
        riskSignals: (c.riskSignals || []).map((r) => r.label),
      })),
    };
  }
}
