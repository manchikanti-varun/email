// PHASE 2C — Focused route-level HTTP integration tests.
// Exercises the real Express app (routing + middleware + validation + real use
// cases + temp SQLite). No production config, no network, no real services.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, registerViaApi } from './helpers/test-app.js';

let h, url;
before(async () => { h = makeTestApp(); url = await h.listen(); });
after(async () => { await h.close(); });

const json = (method, pathname, body, headers = {}) =>
  fetch(url + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ============================ AUTH =========================================
test('POST /api/auth/register creates a user and returns token + one-time apiKey', async () => {
  const r = await registerViaApi(url, 'reg@example.com');
  assert.equal(r.status, 200);
  assert.ok(r.token, 'token returned');
  assert.ok(r.apiKey && r.apiKey.startsWith('elh_'), 'plaintext apiKey returned once');
  assert.equal(r.user.email, 'reg@example.com');
  assert.equal(r.user.credits, 1000);
  assert.equal('password_hash' in r.user, false, 'never leak password hash');
});

test('register: invalid email -> 400; weak password -> 400; duplicate -> 409', async () => {
  assert.equal((await json('POST', '/api/auth/register', { email: 'bad', password: 'password1' })).status, 400);
  assert.equal((await json('POST', '/api/auth/register', { email: 'x@example.com', password: 'short' })).status, 400);
  await json('POST', '/api/auth/register', { email: 'dup@example.com', password: 'password1' });
  assert.equal((await json('POST', '/api/auth/register', { email: 'dup@example.com', password: 'password1' })).status, 409);
});

test('POST /api/auth/login: success returns token; wrong password -> 401', async () => {
  await registerViaApi(url, 'login@example.com', 'password1');
  const ok = await json('POST', '/api/auth/login', { email: 'login@example.com', password: 'password1' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
  const bad = await json('POST', '/api/auth/login', { email: 'login@example.com', password: 'nope12345' });
  assert.equal(bad.status, 401);
});

test('protected endpoint: no token -> 401, invalid token -> 401, valid -> 200', async () => {
  const { token } = await registerViaApi(url, 'prot@example.com');
  assert.equal((await json('GET', '/api/auth/me')).status, 401);
  assert.equal((await json('GET', '/api/auth/me', undefined, { Authorization: 'Bearer not.a.jwt' })).status, 401);
  const ok = await json('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user.email, 'prot@example.com');
});

test('logout revokes the token: protected endpoint rejects it afterwards', async () => {
  const { token } = await registerViaApi(url, 'lo@example.com');
  assert.equal((await json('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` })).status, 200);
  const out = await json('POST', '/api/auth/logout', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(out.status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` })).status, 401,
    'revoked token must be rejected at the HTTP boundary');
});

// ============================ API KEYS =====================================
test('API key: authenticates; rotation invalidates the old key; wrong key rejected', async () => {
  const { token, apiKey } = await registerViaApi(url, 'key@example.com');
  // Old key authenticates.
  assert.equal((await json('GET', '/api/auth/me', undefined, { 'X-API-Key': apiKey })).status, 200);
  // Rotate (needs session auth).
  const rot = await json('POST', '/api/auth/api-key/rotate', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(rot.status, 200);
  const { apiKey: newKey } = await rot.json();
  assert.ok(newKey.startsWith('elh_') && newKey !== apiKey);
  // Old key now rejected; new key accepted; garbage rejected.
  assert.equal((await json('GET', '/api/auth/me', undefined, { 'X-API-Key': apiKey })).status, 401);
  assert.equal((await json('GET', '/api/auth/me', undefined, { 'X-API-Key': newKey })).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, { 'X-API-Key': 'elh_wrong' })).status, 401);
});

// ============================ VERIFICATION =================================
test('POST /api/verify/single: valid request returns result + charges 1 credit', async () => {
  const { token } = await registerViaApi(url, 'ver@example.com');
  const res = await json('POST', '/api/verify/single', { email: 'target@example.com' }, { Authorization: `Bearer ${token}` });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.mailboxStatus, 'UNKNOWN', 'engine UNKNOWN represented correctly');
  assert.equal(body.credits, 999, 'one credit charged');
});

test('verify: missing/invalid email -> 400 and no credit charged', async () => {
  const { token } = await registerViaApi(url, 'ver2@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await json('POST', '/api/verify/single', {}, auth)).status, 400);
  const me = await (await json('GET', '/api/auth/me', undefined, auth)).json();
  assert.equal(me.user.credits, 1000, 'invalid request must not consume a credit');
});

test('verify: unauthenticated -> 401', async () => {
  assert.equal((await json('POST', '/api/verify/single', { email: 'a@b.com' })).status, 401);
});

test('verify: insufficient credits -> 402', async () => {
  const { token, user } = await registerViaApi(url, 'poor@example.com');
  // Drain credits directly via the repo.
  h.repos.users.chargeCredits(user.id, 1000);
  const res = await json('POST', '/api/verify/single', { email: 'a@b.com' }, { Authorization: `Bearer ${token}` });
  assert.equal(res.status, 402);
});

// ============================ LISTS + BULK CHARGE ==========================
test('lists: create via upload, retrieve, unauthorized access -> 404, invalid id -> 404', async () => {
  const { token } = await registerViaApi(url, 'lists@example.com');
  const auth = { Authorization: `Bearer ${token}` };

  // Upload a CSV (multipart).
  const csv = 'email\na@example.com\nb@example.com\na@example.com\n';
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'list.csv');
  const up = await fetch(url + '/api/lists/upload', { method: 'POST', headers: auth, body: form });
  assert.equal(up.status, 200);
  const upBody = await up.json();
  assert.equal(upBody.total, 2, 'deduped to 2');
  assert.equal(upBody.duplicates, 1);
  const listId = upBody.listId;

  // Retrieve.
  const detail = await json('GET', `/api/lists/${listId}`, undefined, auth);
  assert.equal(detail.status, 200);

  // Another user cannot access it.
  const { token: otherToken } = await registerViaApi(url, 'other@example.com');
  const forbidden = await json('GET', `/api/lists/${listId}`, undefined, { Authorization: `Bearer ${otherToken}` });
  assert.equal(forbidden.status, 404, 'ownership enforced');

  // Invalid list id.
  assert.equal((await json('GET', '/api/lists/does-not-exist', undefined, auth)).status, 404);
});

test('bulk verify charge: sufficient credits starts a job; charges pending count', async () => {
  const { token, user } = await registerViaApi(url, 'bulk@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const csv = 'email\n' + Array.from({ length: 5 }, (_, i) => `u${i}@example.com`).join('\n') + '\n';
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'list.csv');
  const up = await (await fetch(url + '/api/lists/upload', { method: 'POST', headers: auth, body: form })).json();

  const start = await json('POST', `/api/lists/${up.listId}/verify`, undefined, auth);
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.equal(startBody.started, true);
  assert.equal(startBody.total, 5, 'charges pending count = 5');

  const me = await (await json('GET', '/api/auth/me', undefined, auth)).json();
  assert.equal(me.user.credits, 995, '5 credits charged before work');
});

test('bulk verify charge: insufficient credits -> 402, no job, credits unchanged', async () => {
  const { token, user } = await registerViaApi(url, 'bulkpoor@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const csv = 'email\n' + Array.from({ length: 5 }, (_, i) => `p${i}@example.com`).join('\n') + '\n';
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'list.csv');
  const up = await (await fetch(url + '/api/lists/upload', { method: 'POST', headers: auth, body: form })).json();

  // Leave only 4 credits (need 5).
  h.repos.users.chargeCredits(user.id, 996);
  const start = await json('POST', `/api/lists/${up.listId}/verify`, undefined, auth);
  assert.equal(start.status, 402);
  const body = await start.json();
  assert.equal(body.needed, 5);
  assert.equal(h.repos.users.findById(user.id).credits, 4, 'credits unchanged on failed charge');
  // No job row created.
  const jobCount = h.db.prepare('SELECT COUNT(*) n FROM jobs WHERE list_id = ?').get(up.listId).n;
  assert.equal(jobCount, 0, 'no job started when charge fails');
});

// ============================ WEBHOOKS + SSRF ==============================
test('webhooks: create, list (no secret), delete, ownership', async () => {
  const { token } = await registerViaApi(url, 'wh@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const create = await json('POST', '/api/integrations/webhooks', { url: 'https://hooks.example.com/x', event: 'job.completed', secret: 'shh' }, auth);
  assert.equal(create.status, 200);
  const created = await create.json();

  const list = await (await json('GET', '/api/integrations/webhooks', undefined, auth)).json();
  assert.equal(list.webhooks.length, 1);
  assert.equal('secret' in list.webhooks[0], false, 'secret never exposed via list');
  // DB stores ciphertext, not plaintext.
  const raw = h.db.prepare('SELECT secret, secret_enc FROM webhooks WHERE id = ?').get(created.id);
  assert.equal(raw.secret, null);
  assert.ok(raw.secret_enc && raw.secret_enc.startsWith('v1:'), 'secret encrypted at rest');

  // Ownership: another user cannot delete it.
  const { token: other } = await registerViaApi(url, 'wh2@example.com');
  assert.equal((await json('DELETE', `/api/integrations/webhooks/${created.id}`, undefined, { Authorization: `Bearer ${other}` })).status, 404);
  // Owner can delete.
  assert.equal((await json('DELETE', `/api/integrations/webhooks/${created.id}`, undefined, auth)).status, 200);
});

test('SSRF: webhook registration blocks localhost/loopback/private/metadata/.local/.internal/protocol/malformed', async () => {
  const { token } = await registerViaApi(url, 'ssrf@example.com');
  const auth = { Authorization: `Bearer ${token}` };
  const blocked = [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://[::1]/x',
    'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/x',
    'http://172.16.0.1/x', 'http://192.168.1.1/x', 'http://svc.local/x',
    'http://svc.internal/x', 'ftp://example.com/x', 'not-a-url',
  ];
  for (const badUrl of blocked) {
    const res = await json('POST', '/api/integrations/webhooks', { url: badUrl }, auth);
    assert.equal(res.status, 400, `must reject ${badUrl}`);
  }
  // A public URL is accepted.
  assert.equal((await json('POST', '/api/integrations/webhooks', { url: 'https://ok.example.com/x' }, auth)).status, 200);
});

// ============================ HEALTH / READY ===============================
test('GET /api/health -> 200 capability; GET /api/ready -> 200 ready', async () => {
  const health = await json('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.ok((await health.json()).verification, 'health carries capability');
  const ready = await json('GET', '/api/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ready: true });
});
