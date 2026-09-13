// Short-term conversation memory for the agent. In-process, per-conversation,
// bounded, and TTL-expired. Deliberately NOT persisted: it holds transient
// working state (current list, last tool results, pending confirmation) and we
// don't want to accumulate sensitive data. Durable accountability lives in the
// agent_audit_logs table instead.
//
// This is a singleton store keyed by `${userId}:${conversationId}`.

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 12;          // cap transcript length kept in memory
const MAX_CONVERSATIONS = 500; // global cap to bound memory usage

class ConversationMemory {
  constructor() {
    this.currentListId = null;
    this.currentTask = null;
    this.lastRequest = null;
    this.pendingConfirmation = null; // { tool, args, summary, token }
    this.toolResults = [];           // [{ tool, args, result, at }]
    this.turns = [];                 // [{ role, content, at }]
    this.updatedAt = Date.now();
  }

  touch() { this.updatedAt = Date.now(); }

  addTurn(role, content) {
    this.turns.push({ role, content, at: Date.now() });
    if (this.turns.length > MAX_TURNS) this.turns = this.turns.slice(-MAX_TURNS);
    this.touch();
  }

  recordToolResult(tool, args, result) {
    this.toolResults.push({ tool, args, result, at: Date.now() });
    if (this.toolResults.length > MAX_TURNS) this.toolResults = this.toolResults.slice(-MAX_TURNS);
    this.touch();
  }

  reset() {
    this.currentTask = null;
    this.pendingConfirmation = null;
    this.toolResults = [];
    this.touch();
  }
}

const store = new Map();

function key(userId, conversationId) { return `${userId}:${conversationId}`; }

function sweep() {
  const now = Date.now();
  for (const [k, mem] of store) {
    if (now - mem.updatedAt > TTL_MS) store.delete(k);
  }
  // Hard cap: drop oldest if we somehow exceed the ceiling.
  if (store.size > MAX_CONVERSATIONS) {
    const entries = [...store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < entries.length - MAX_CONVERSATIONS; i++) store.delete(entries[i][0]);
  }
}

export function getMemory(userId, conversationId) {
  sweep();
  const k = key(userId, conversationId);
  let mem = store.get(k);
  if (!mem) { mem = new ConversationMemory(); store.set(k, mem); }
  mem.touch();
  return mem;
}

export function clearMemory(userId, conversationId) {
  store.delete(key(userId, conversationId));
}

// Exposed for tests.
export function _debugSize() { return store.size; }
