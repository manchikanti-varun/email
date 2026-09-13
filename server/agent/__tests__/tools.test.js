import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../tools.js';
import { PERMISSION } from '../permissions.js';
import { makeFakeUseCases, FAKE_USER } from './helpers.js';

const sampleData = () => ({
  credits: 500,
  lists: [{ id: 'L1', name: 'Customers', total: 100, status: 'done', health: 87 }],
  contacts: {
    L1: [
      { email: 'a@x.com', deliverability: 'deliverable', classification: 'safe', confidence: 'high', score: 100, riskSignals: [] },
      { email: 'b@x.com', deliverability: 'undeliverable', classification: 'remove', confidence: 'high', score: 5, riskSignals: [{ label: 'No MX' }] },
      { email: 'c@x.com', deliverability: 'risky', classification: 'review', confidence: 'medium', score: 55, riskSignals: [{ label: 'Catch-all' }] },
      { email: 'd@x.com', deliverability: 'unknown', classification: 'unknown', confidence: 'unknown', score: 50, riskSignals: [] },
    ],
  },
});

function ctxFor(data) {
  const { uc, state } = makeFakeUseCases(data);
  return { ctx: { userId: FAKE_USER.id, useCases: uc, config: {} }, state };
}

test('every tool has required descriptor fields', () => {
  for (const t of registry.list()) {
    assert.ok(t.name, 'name');
    assert.ok(t.description, `${t.name} description`);
    assert.ok(t.input, `${t.name} input schema`);
    assert.ok(Object.values(PERMISSION).includes(t.permission), `${t.name} permission`);
    assert.equal(typeof t.confirm, 'boolean', `${t.name} confirm`);
    assert.equal(typeof t.run, 'function', `${t.name} run`);
  }
});

test('registry exposes all required tool names', () => {
  const required = [
    'verify_email' in {} ? 'verify_email' : null, // not required for this build
  ].filter(Boolean);
  // The spec's core tool set (excluding verify_email single-email which the app
  // exposes via /verify): ensure the important ones exist.
  const expected = ['get_lists', 'get_list', 'analyze_list', 'get_list_health', 'get_health_history',
    'get_contacts', 'get_contacts_by_classification', 'get_risky_contacts', 'get_unknown_contacts',
    'get_remove_contacts', 'get_cleaning_plan', 'run_campaign_preflight', 'start_verification',
    'start_reverification', 'get_verification_progress', 'get_alerts', 'get_account_credits',
    'export_list', 'delete_contacts', 'delete_list'];
  for (const name of expected) assert.ok(registry.has(name), `missing tool ${name}`);
});

test('get_lists returns the user lists', async () => {
  const { ctx } = ctxFor(sampleData());
  const r = await registry.get('get_lists').run(ctx, {});
  assert.equal(r.lists.length, 1);
  assert.equal(r.lists[0].name, 'Customers');
});

test('get_risky_contacts filters to risky deliverability only', async () => {
  const { ctx } = ctxFor(sampleData());
  const r = await registry.get('get_risky_contacts').run(ctx, { listId: 'L1', limit: 50 });
  assert.equal(r.matched, 1);
  assert.equal(r.contacts[0].deliverability, 'risky');
});

test('get_unknown_contacts returns unknowns (re-verify candidates)', async () => {
  const { ctx } = ctxFor(sampleData());
  const r = await registry.get('get_unknown_contacts').run(ctx, { listId: 'L1', limit: 50 });
  assert.equal(r.matched, 1);
  assert.equal(r.contacts[0].classification, 'unknown');
});

test('get_cleaning_plan returns deterministic bucket counts', async () => {
  const { ctx } = ctxFor(sampleData());
  const r = await registry.get('get_cleaning_plan').run(ctx, { listId: 'L1' });
  assert.equal(r.keep, 1);
  assert.equal(r.remove, 1);
  assert.equal(r.review, 2); // review + unknown
});

test('get_reverify_cost estimates without charging credits', async () => {
  const { ctx, state } = ctxFor(sampleData());
  const before = state.credits;
  const r = await registry.get('get_reverify_cost').run(ctx, { listId: 'L1', reverify: true });
  assert.equal(r.estimatedCredits, 100);
  assert.equal(r.availableCredits, 500);
  assert.equal(r.affordable, true);
  assert.equal(state.credits, before, 'no credits spent by estimate');
});

test('delete_contacts removes only the given classification', async () => {
  const { ctx, state } = ctxFor(sampleData());
  const r = await registry.get('delete_contacts').run(ctx, { listId: 'L1', classification: 'remove' });
  assert.equal(r.deleted, 1);
  assert.equal((state.contacts.L1 || []).some((c) => c.classification === 'remove'), false);
});

test('run_campaign_preflight throws on unverified list (surfaced, not faked)', async () => {
  const { ctx } = ctxFor({ lists: [{ id: 'L2', name: 'Empty', total: 0, status: 'pending', health: null }], contacts: {} });
  await assert.rejects(async () => registry.get('run_campaign_preflight').run(ctx, { listId: 'L2' }));
});
