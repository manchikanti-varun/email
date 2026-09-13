// Verifies the audit repository against a real (temporary) SQLite database,
// exercising the same DDL the app uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAgentAuditRepository } from '../../src/infrastructure/persistence/sqlite/agent-audit-repository.js';

function tempDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE agent_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_request TEXT,
      tool_name TEXT NOT NULL,
      tool_args TEXT,
      permission TEXT NOT NULL DEFAULT 'read',
      status TEXT NOT NULL DEFAULT 'ok',
      confirmed INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
  db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
  return db;
}

test('records and reads back an audit entry', () => {
  const db = tempDb();
  const repo = new SqliteAgentAuditRepository(db);
  repo.record({ userId: 'u1', conversationId: 'c1', userRequest: 'clean list', toolName: 'delete_contacts', toolArgs: { listId: 'L1', classification: 'remove' }, permission: 'destructive', status: 'ok', confirmed: true, durationMs: 12 });
  const rows = repo.findByUser('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool_name, 'delete_contacts');
  assert.equal(rows[0].permission, 'destructive');
  assert.equal(rows[0].confirmed, 1);
  assert.match(rows[0].tool_args, /L1/);
});

test('findByConversation returns entries in ascending order', () => {
  const db = tempDb();
  const repo = new SqliteAgentAuditRepository(db);
  repo.record({ userId: 'u1', conversationId: 'c1', toolName: 'get_lists', permission: 'read' });
  repo.record({ userId: 'u1', conversationId: 'c1', toolName: 'get_list_health', permission: 'read' });
  repo.record({ userId: 'u1', conversationId: 'c2', toolName: 'get_alerts', permission: 'read' });
  const rows = repo.findByConversation('u1', 'c1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tool_name, 'get_lists');
});

test('null toolArgs is stored as null (no crash)', () => {
  const db = tempDb();
  const repo = new SqliteAgentAuditRepository(db);
  repo.record({ userId: 'u1', conversationId: 'c1', toolName: 'get_lists', permission: 'read', toolArgs: null });
  assert.equal(repo.findByUser('u1')[0].tool_args, null);
});
