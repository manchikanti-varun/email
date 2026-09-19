import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStableVerdict } from '../verdict-stability.js';

const deliverable = { deliverability: 'deliverable', confidence: 'high' };
const undeliverable = { deliverability: 'undeliverable', confidence: 'high' };
const accepted = { deliverability: 'accepted', confidence: 'medium' };
const unknown = { deliverability: 'unknown', confidence: 'low' };

test('inconclusive re-probe does NOT downgrade a prior confirmed deliverable', () => {
  const { result, kept } = chooseStableVerdict(deliverable, unknown);
  assert.equal(kept, true);
  assert.equal(result.deliverability, 'deliverable');
});

test('inconclusive re-probe keeps a prior undeliverable', () => {
  const { result, kept } = chooseStableVerdict(undeliverable, unknown);
  assert.equal(kept, true);
  assert.equal(result.deliverability, 'undeliverable');
});

test('inconclusive re-probe keeps a prior accepted (catch-all)', () => {
  const { result, kept } = chooseStableVerdict(accepted, unknown);
  assert.equal(kept, true);
  assert.equal(result.deliverability, 'accepted');
});

test('fresh conclusive evidence always wins (real change propagates)', () => {
  // A mailbox that started bouncing must flip even though prior was deliverable.
  const { result, kept } = chooseStableVerdict(deliverable, undeliverable);
  assert.equal(kept, false);
  assert.equal(result.deliverability, 'undeliverable');
});

test('no prior verdict -> take the fresh result', () => {
  const { result, kept } = chooseStableVerdict(null, unknown);
  assert.equal(kept, false);
  assert.equal(result.deliverability, 'unknown');
});

test('prior was itself inconclusive -> take the fresh result (greylist retry works)', () => {
  const { result, kept } = chooseStableVerdict(unknown, deliverable);
  assert.equal(kept, false);
  assert.equal(result.deliverability, 'deliverable');
});
