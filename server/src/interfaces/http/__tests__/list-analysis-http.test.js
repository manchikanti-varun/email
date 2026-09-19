// HTTP integration for the AI List Health Analysis endpoints, through the real
// Express app + real use cases + temp DB (no external LLM; deterministic path).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, registerViaApi } from './helpers/test-app.js';

let h, url;
before(async () => { h = makeTestApp(); url = await h.listen(); });
after(async () => { await h.close(); });

const json = (method, pathname, body, headers = {}) =>
  fetch(url + pathname, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Upload a CSV and return its listId (verification is not run; contacts start
// unverified — enough to exercise the analysis endpoints deterministically).
async function uploadList(auth, csv) {
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'list.csv');
  const up = await fetch(url + '/api/lists/upload', { method: 'POST', headers: auth, body: form });
  return (await up.json()).listId;
}

test('POST /api/ai/lists/:id/analyze requires authentication', async () => {
  const res = await json('POST', '/api/ai/lists/whatever/analyze', {});
  assert.equal(res.status, 401);
});

test('POST analyze returns a deterministic health report + diagnosis', async () => {
  const { token } = await registerViaApi(url, 'analyze@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const listId = await uploadList(auth, 'email\na@gmail.com\nb@gmail.com\nc@acme.io\n');

  const res = await json('POST', `/api/ai/lists/${listId}/analyze`, {}, auth);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.healthScore, 'number');
  assert.ok(['Excellent', 'Good', 'Needs Attention', 'Poor', 'Critical'].includes(body.healthLevel));
  assert.ok(body.metrics && typeof body.metrics.total === 'number');
  assert.ok(body.scoreModel && body.scoreModel.formula, 'score is explainable');
  assert.ok(body.diagnosis && typeof body.diagnosis.summary === 'string');
  // No model configured in tests -> deterministic diagnosis.
  assert.equal(body.diagnosisMeta.source, 'deterministic');
  assert.ok(Array.isArray(body.recommendations));
  assert.ok(Array.isArray(body.riskSignals));
});

test('GET analysis returns not-analyzed then the persisted analysis', async () => {
  const { token } = await registerViaApi(url, 'persist@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const listId = await uploadList(auth, 'email\nx@gmail.com\n');

  const before = await json('GET', `/api/ai/lists/${listId}/analysis`, undefined, auth);
  assert.equal(before.status, 200);
  assert.equal((await before.json()).available, false);

  await json('POST', `/api/ai/lists/${listId}/analyze`, {}, auth);

  const after = await json('GET', `/api/ai/lists/${listId}/analysis`, undefined, auth);
  const body = await after.json();
  assert.equal(body.available, true);
  assert.equal(typeof body.healthScore, 'number');
  assert.equal(body.diagnosisSource, 'deterministic');
});

test('ownership: another user cannot analyze or read a list (404)', async () => {
  const { token } = await registerViaApi(url, 'owner2@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const listId = await uploadList(auth, 'email\no@gmail.com\n');

  const { token: other } = await registerViaApi(url, 'intruder@example.com');
  const otherAuth = { Authorization: `Bearer ${other}` };

  assert.equal((await json('POST', `/api/ai/lists/${listId}/analyze`, {}, otherAuth)).status, 404);
  assert.equal((await json('GET', `/api/ai/lists/${listId}/analysis`, undefined, otherAuth)).status, 404);
});
