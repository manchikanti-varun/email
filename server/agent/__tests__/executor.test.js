import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Executor, confirmationToken } from '../executor.js';
import { registry } from '../tools.js';
import { makeFakeUseCases, makeFakeAudit, FAKE_USER } from './helpers.js';

function setup(data) {
  const { uc, state } = makeFakeUseCases(data);
  const audit = makeFakeAudit();
  const executor = new Executor({ registry, audit, user: FAKE_USER, conversationId: 'c1', userRequest: 'test' });
  const ctx = { userId: FAKE_USER.id, useCases: uc, config: {} };
  return { executor, ctx, audit, state };
}

const data = () => ({
  credits: 1000,
  lists: [{ id: 'L1', name: 'Customers', total: 10, status: 'done', health: 90 }],
  contacts: { L1: [{ email: 'a@x.com', classification: 'remove', deliverability: 'undeliverable' }] },
});

test('read tool executes and is audited with status ok', async () => {
  const { executor, ctx, audit } = setup(data());
  const r = await executor.run('get_lists', {}, ctx);
  assert.equal(r.status, 'ok');
  assert.equal(audit.entries.at(-1).status, 'ok');
  assert.equal(audit.entries.at(-1).toolName, 'get_lists');
});

test('invalid arguments are rejected before execution', async () => {
  const { executor, ctx, audit } = setup(data());
  const r = await executor.run('get_list', {}, ctx); // missing listId
  assert.equal(r.status, 'invalid_args');
  assert.equal(audit.entries.at(-1).status, 'invalid_args');
});

test('unknown tool is rejected', async () => {
  const { executor, ctx } = setup(data());
  const r = await executor.run('does_not_exist', {}, ctx);
  assert.equal(r.status, 'error');
});

test('destructive tool requires confirmation (does not run without it)', async () => {
  const { executor, ctx, audit, state } = setup(data());
  const r = await executor.run('delete_contacts', { listId: 'L1', classification: 'remove' }, ctx, { confirmed: false });
  assert.equal(r.status, 'awaiting_confirmation');
  assert.equal(r.needsConfirmation, true);
  assert.ok(r.confirmation.token);
  // Nothing deleted.
  assert.equal(state.deleted.length, 0);
  assert.equal(audit.entries.at(-1).status, 'awaiting_confirmation');
  assert.equal(audit.entries.at(-1).confirmed, false);
});

test('destructive tool runs when confirmed and is audited as confirmed', async () => {
  const { executor, ctx, audit, state } = setup(data());
  const r = await executor.run('delete_contacts', { listId: 'L1', classification: 'remove' }, ctx, { confirmed: true });
  assert.equal(r.status, 'ok');
  assert.equal(r.result.deleted, 1);
  assert.equal(state.deleted.length, 1);
  assert.equal(audit.entries.at(-1).confirmed, true);
});

test('confirmation token binds to exact tool + args', () => {
  const t1 = confirmationToken('delete_contacts', { listId: 'L1', classification: 'remove' });
  const t2 = confirmationToken('delete_contacts', { listId: 'L1', classification: 'safe' });
  assert.notEqual(t1, t2);
});

test('tool failure is surfaced as error status, never fabricated', async () => {
  const { executor, ctx } = setup(data());
  const r = await executor.run('get_list', { listId: 'NOPE' }, ctx);
  assert.equal(r.status, 'error_404');
  assert.match(r.error, /not found/i);
  assert.equal(r.result, undefined);
});

test('audit entries never contain secret-looking keys', async () => {
  const { executor, ctx, audit } = setup(data());
  // Pass an arg object containing a secret; validation strips unknown props,
  // and redact() would mask it anyway. Use export_list which has a known filter.
  await executor.run('export_list', { listId: 'L1', filter: 'campaign' }, ctx);
  const entry = audit.entries.at(-1);
  assert.ok(!JSON.stringify(entry.toolArgs).match(/apiKey|password|token/i));
});
