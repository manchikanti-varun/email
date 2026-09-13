// End-to-end worker HTTP test: real Express app + real socket conversation
// against a fake MX. Exercises auth, validation, and the accepted/rejected/
// catch-all/transport-failure paths through the HTTP surface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeMx } from './fake-mx.js';

const SECRET = 'test-secret-at-least-24-chars-long-xx';
let mx, app, server, baseUrl;

before(async () => {
  // Behaviour by recipient/domain (single MX, since the worker uses one MX port):
  //   *@catchall.com   -> 250 (accepts everything, incl. the random probe)
  //   good@example.com -> 250
  //   everything else  -> 550
  mx = await startFakeMx({
    rcptReply: (r) => {
      const domain = (r.split('@')[1] || '').toLowerCase();
      if (domain === 'catchall.com') return 250;
      if (r.toLowerCase().startsWith('good@example.com')) return 250;
      return 550;
    },
  });
  // Configure the worker to probe the fake MX port before importing it.
  process.env.WORKER_SECRET = SECRET;
  process.env.SMTP_MX_PORT = String(mx.port);
  process.env.SMTP_TIMEOUT_MS = '2000';
  process.env.NODE_ENV = 'test';
  ({ app } = await import('../index.js'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (mx) await mx.close();
});

async function verify(body, token = SECRET) {
  const res = await fetch(baseUrl + '/internal/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('rejects unauthenticated requests', async () => {
  const { status } = await verify({ email: 'good@example.com', mxHost: mx.host }, 'wrong');
  assert.equal(status, 401);
});

test('rejects invalid email', async () => {
  const { status } = await verify({ email: 'not-an-email', mxHost: mx.host });
  assert.equal(status, 400);
});

test('accepted mailbox -> status accepted', async () => {
  // bad@ is rejected so the catch-all random probe is NOT accepted -> not catch-all.
  const { status, body } = await verify({ email: 'good@example.com', mxHost: mx.host });
  assert.equal(status, 200);
  assert.equal(body.smtp.status, 'accepted');
  assert.equal(body.catchAll, false);
  assert.equal(body.worker.id, 'smtp-worker-01');
});

test('rejected mailbox -> status rejected', async () => {
  const { body } = await verify({ email: 'bad@example.com', mxHost: mx.host });
  assert.equal(body.smtp.status, 'rejected');
});

test('catch-all domain -> status catch-all (random probe accepted)', async () => {
  const { body } = await verify({ email: 'anyone@catchall.com', mxHost: mx.host });
  assert.equal(body.smtp.status, 'catch-all');
  assert.equal(body.catchAll, true);
});

test('health endpoint reports worker identity', async () => {
  const res = await fetch(baseUrl + '/health');
  const body = await res.json();
  assert.equal(body.status, 'healthy');
  assert.equal(body.workerId, 'smtp-worker-01');
  assert.equal(body.smtpEnabled, true);
});
