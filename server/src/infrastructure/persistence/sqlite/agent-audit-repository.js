// Persistence for the AI agent's action audit log. Mirrors the pattern of the
// other SQLite repositories (nanoid ids, synchronous better-sqlite3). The
// caller is responsible for redacting secrets from `toolArgs`; this repository
// stores whatever it is given, JSON-encoding the argument object.
import { nanoid } from 'nanoid';
import { AgentAuditRepository } from '../../../domain/ports/index.js';

export class SqliteAgentAuditRepository extends AgentAuditRepository {
  constructor(db) {
    super();
    this.db = db;
    this._insert = db.prepare(
      `INSERT INTO agent_audit_logs
        (id, user_id, conversation_id, user_request, tool_name, tool_args,
         permission, status, confirmed, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
  }

  record(entry) {
    const {
      userId,
      conversationId,
      userRequest = null,
      toolName,
      toolArgs = null,
      permission = 'read',
      status = 'ok',
      confirmed = false,
      durationMs = 0,
      error = null,
    } = entry;
    const id = nanoid();
    this._insert.run(
      id, userId, conversationId,
      truncate(userRequest, 2000),
      toolName,
      toolArgs == null ? null : truncate(JSON.stringify(toolArgs), 4000),
      permission, status, confirmed ? 1 : 0,
      Math.round(durationMs) || 0,
      error == null ? null : truncate(String(error), 2000)
    );
    return id;
  }

  findByUser(userId, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM agent_audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit);
  }

  findByConversation(userId, conversationId, limit = 50) {
    return this.db.prepare(
      `SELECT * FROM agent_audit_logs
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at ASC LIMIT ?`
    ).all(userId, conversationId, limit);
  }
}

function truncate(s, max) {
  if (s == null) return s;
  const str = String(s);
  return str.length > max ? str.slice(0, max) + '…' : str;
}
