import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailHealthAgent } from '../agent.js';
import { AiProvider } from '../provider.js';
import { registry } from '../tools.js';
import { makeFakeUseCases, makeFakeAudit, FAKE_USER, AI_CONFIG } from './helpers.js';

function makeAgent(data, aiOverrides = {}) {
  const { uc, state } = makeFakeUseCases(data);
  const audit = makeFakeAudit();
  const config = { ai: { ...AI_CONFIG, ...aiOverrides } };
  const agent = new MailHealthAgent({
    config,
    provider: new AiProvider(config.ai),
    registry,
    audit,
    toolContextFactory: (user) => ({ userId: user.id, useCases: uc, config }),
  });
  return { agent, audit, state };
}

const readyData = () => ({
  credits: 1000,
  lists: [{ id: 'L1', name: 'Customer list', total: 4, status: 'done', health: 87 }],
  contacts: {
    L1: [
      { email: 'a@x.com', classification: 'safe', deliverability: 'deliverable', confidence: 'high' },
      { email: 'b@x.com', classification: 'safe', deliverability: 'deliverable', confidence: 'high' },
      { email: 'c@x.com', classification: 'remove', deliverability: 'undeliverable', confidence: 'high' },
      { email: 'd@x.com', classification: 'unknown', deliverability: 'unknown', confidence: 'unknown' },
    ],
  },
  history: { L1: [{ health: 92, counts: { safe: 3, review: 0, remove: 0, unknown: 1 } }, { health: 81, counts: { safe: 2, review: 0, remove: 1, unknown: 1 } }] },
});

test('disabled agent returns graceful message and performs no work', async () => {
  const { agent, audit } = makeAgent(readyData(), { enabled: false });
  const r = await agent.run({ user: FAKE_USER, message: 'analyze my list' });
  assert.match(r.message, /disabled/i);
  assert.equal(r.actions.length, 0);
  assert.equal(audit.entries.length, 0);
});

test('multi-step readiness question uses health + preflight tools', async () => {
  const { agent } = makeAgent(readyData());
  const r = await agent.run({ user: FAKE_USER, message: 'Is my customer list ready to send?', listId: 'L1' });
  const tools = r.actions.map((a) => a.tool);
  assert.ok(tools.includes('get_list_health'));
  assert.ok(tools.includes('run_campaign_preflight'));
  assert.match(r.message, /recipients|safe/i);
  // Response carries provenance metadata.
  assert.ok(r.generatedAt);
  assert.equal(r.inputVersion, 'ctx-v1');
});

test('"why did health drop" compares snapshots with concrete numbers', async () => {
  const { agent } = makeAgent(readyData());
  const r = await agent.run({ user: FAKE_USER, message: 'Why did my list health fall?', listId: 'L1' });
  assert.ok(r.actions.map((a) => a.tool).includes('get_health_history'));
  assert.match(r.message, /81\/100/);
  assert.match(r.message, /92\/100/);
});

test('clean request proposes a confirmation, never auto-deletes', async () => {
  const { agent, state } = makeAgent(readyData());
  const r = await agent.run({ user: FAKE_USER, message: 'Clean this list', listId: 'L1' });
  assert.ok(r.pendingConfirmation, 'should ask for confirmation');
  assert.equal(r.pendingConfirmation.tool, 'delete_contacts');
  assert.equal(r.pendingConfirmation.permission, 'destructive');
  assert.equal(state.deleted.length, 0, 'nothing deleted before confirmation');
});

test('confirming a proposed deletion executes it', async () => {
  const { agent, state } = makeAgent(readyData());
  const conv = await agent.run({ user: FAKE_USER, message: 'Clean this list', listId: 'L1' });
  const pc = conv.pendingConfirmation;
  const r = await agent.run({
    user: FAKE_USER, message: '', conversationId: conv.conversationId,
    confirm: { tool: pc.tool, args: pc.args, token: pc.token },
  });
  assert.match(r.message, /removed 1/i);
  assert.equal(state.deleted.length, 1);
});

test('a stale/incorrect confirmation token is rejected', async () => {
  const { agent, state } = makeAgent(readyData());
  const conv = await agent.run({ user: FAKE_USER, message: 'Clean this list', listId: 'L1' });
  const r = await agent.run({
    user: FAKE_USER, message: '', conversationId: conv.conversationId,
    confirm: { tool: 'delete_contacts', args: { listId: 'L1', classification: 'remove' }, token: 'bogus-token' },
  });
  assert.match(r.message, /no longer valid|re-issue/i);
  assert.equal(state.deleted.length, 0);
});

test('credit protection: reverify stops when credits insufficient', async () => {
  const data = readyData();
  data.credits = 2; // less than list size (4)
  const { agent, state } = makeAgent(data);
  const r = await agent.run({ user: FAKE_USER, message: 're-verify this list', listId: 'L1' });
  assert.match(r.message, /short|insufficient|stopped/i);
  assert.equal(state.started.length, 0, 'no verification started');
  assert.equal(r.pendingConfirmation, null);
});

test('credit protection: affordable reverify asks for confirmation with cost', async () => {
  const { agent, state } = makeAgent(readyData());
  const r = await agent.run({ user: FAKE_USER, message: 're-verify this list', listId: 'L1' });
  assert.ok(r.pendingConfirmation);
  assert.equal(r.pendingConfirmation.tool, 'start_reverification');
  assert.match(r.message, /4 credits|cost/i);
  assert.equal(state.started.length, 0);
});

test('loop protection: hard iteration cap is enforced', async () => {
  const { agent } = makeAgent(readyData(), { maxIterations: 1 });
  // Force a planner that always asks for a tool so it never finalizes.
  agent.planner._heuristic = () => ({ action: 'tool', tool: 'get_lists', args: {}, thought: '', message: '' });
  const r = await agent.run({ user: FAKE_USER, message: 'loop please', listId: 'L1' });
  assert.match(r.message, /limit/i);
  assert.equal(r.meta.iterations, 1);
});

test('no lists -> guides the user, does not fabricate data', async () => {
  const { agent } = makeAgent({ credits: 100, lists: [] });
  const r = await agent.run({ user: FAKE_USER, message: 'analyze my list' });
  assert.match(r.message, /no lists/i);
});

test('every tool call is recorded in the audit log', async () => {
  const { agent, audit } = makeAgent(readyData());
  await agent.run({ user: FAKE_USER, message: 'analyze my list', listId: 'L1' });
  assert.ok(audit.entries.length >= 1);
  for (const e of audit.entries) {
    assert.equal(e.userId, FAKE_USER.id);
    assert.ok(e.conversationId);
    assert.ok(e.toolName);
    assert.ok(['read', 'action', 'destructive'].includes(e.permission));
  }
});
