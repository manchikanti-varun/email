import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationQueue } from '../verification-queue.js';

test('queue publishes progress after every contact (not every 25)', async () => {
  const progressWrites = [];
  const emails = Array.from({ length: 7 }, (_, i) => `u${i}@example.com`);
  const pending = emails.map((email, i) => ({ id: `c${i}`, email }));

  const queue = new VerificationQueue({
    jobRepository: {
      markRunning() {},
      updateProgress(_id, done) { progressWrites.push(done); },
      markDone() {},
      nextRunnable: () => null,
      create: () => ({ id: 'j1' }),
      countUnfinished: () => 0,
    },
    listRepository: {
      setStatus() {},
      findById: () => ({ id: 'l1', name: 't', user_id: 'u' }),
    },
    contactRepository: {
      findPending: () => pending,
      saveResult() {},
      findByList: () => [],
    },
    historyRepository: { add() {}, latest: () => [] },
    alertRepository: { create() {} },
    verificationEngine: {
      preResolveDomains: async () => {},
      verify: async (email) => ({
        email, score: 50, classification: 'unknown', status: 'unknown',
        signals: [], reasons: [], recommendation: '', greylisted: false,
        provider: null, deliverability: 'unknown', confidence: 'low',
        recommendedAction: 'reverify', riskSignals: [], verified_at: new Date().toISOString(),
      }),
    },
    webhookSender: { fire() {} },
    summarize: () => ({ health: 50, counts: { safe: 0, review: 0, remove: 0, unknown: 7 }, total: 7, metrics: {} }),
    concurrency: 2,
  });

  await queue._runJob({ id: 'j1', list_id: 'l1', user_id: 'u', type: 'verify', done: 0 });

  // Initial publish (0) + one write per completed contact.
  assert.ok(progressWrites.includes(0), 'should publish starting progress');
  assert.ok(progressWrites.includes(1), 'must update after the first contact (was stuck at 0 until 25)');
  assert.ok(progressWrites.includes(7), 'should reach full count');
  assert.ok(progressWrites.filter((n) => n > 0).length >= 7, 'progress after every contact');
});
