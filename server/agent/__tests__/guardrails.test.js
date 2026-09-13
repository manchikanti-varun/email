import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, maskEmail, minimizeForPrompt } from '../guardrails.js';

test('redact masks secret-looking keys recursively', () => {
  const out = redact({ apiKey: 'sk-123', nested: { password: 'p', token: 't', ok: 1 }, arr: [{ authorization: 'Bearer x' }] });
  assert.equal(out.apiKey, '[redacted]');
  assert.equal(out.nested.password, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.ok, 1);
  assert.equal(out.arr[0].authorization, '[redacted]');
});

test('maskEmail hides the local part', () => {
  assert.equal(maskEmail('johndoe@example.com'), 'jo***@example.com');
  assert.equal(maskEmail('ab@x.com'), 'ab@x.com');
  assert.equal(maskEmail('not-an-email'), '[email]');
});

test('minimizeForPrompt caps and masks sample contacts', () => {
  const ctx = { sampleContacts: Array.from({ length: 20 }, (_, i) => ({ email: `user${i}@x.com`, deliverability: 'unknown', classification: 'unknown' })) };
  const out = minimizeForPrompt(ctx);
  assert.equal(out.sampleContacts.length, 5);
  assert.match(out.sampleContacts[0].email, /\*\*\*@x\.com/);
});
