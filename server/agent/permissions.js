// Permission model for agent tools. Three levels, in increasing sensitivity:
//   READ        - inspect data only (lists, health, history, contacts, credits)
//   ACTION      - spend credits or export (verification, re-verification, export)
//   DESTRUCTIVE - irreversible data changes (delete contacts, delete list)
//
// DESTRUCTIVE tools always require explicit user confirmation before they run.
// The executor enforces this: it will refuse to run a destructive tool unless
// the request carries a matching confirmation token.

export const PERMISSION = Object.freeze({
  READ: 'read',
  ACTION: 'action',
  DESTRUCTIVE: 'destructive',
});

const RANK = { read: 0, action: 1, destructive: 2 };

export function rank(level) {
  return RANK[level] ?? 0;
}

export function requiresConfirmation(tool) {
  return tool.permission === PERMISSION.DESTRUCTIVE || tool.confirm === true;
}

// The set of permission levels a user is allowed to have the agent perform.
// Today every authenticated user may perform all levels (subject to
// confirmation for destructive ops), but this is the single choke point where
// a plan/role restriction would live.
export function allowedLevels(_user) {
  return new Set([PERMISSION.READ, PERMISSION.ACTION, PERMISSION.DESTRUCTIVE]);
}

export function isAllowed(user, tool) {
  return allowedLevels(user).has(tool.permission);
}
