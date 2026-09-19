// Required MailHealth SMTP upgrade scenarios:
//  1. Primary MX timeout → secondary MX succeeds
//  2. Definitive 550 → UNDELIVERABLE
//  3. All MX timeout → UNKNOWN
//  4. Real + random address both 250 → ACCEPT_ALL
//  5. Temporary 4xx → UNKNOWN/REVERIFY
//  6. Railway timeout + VPS 550 → UNDELIVERABLE
//
// Core rule: timeout/network failure is NEVER invalid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VerificationEngine,
  DELIVERABILITY,
  ACTION,
  MAILBOX_STATUS,
  VERIFICATION_QUALITY,
} from '../engine.js';
import { SocketSmtpProbe } from '../../../infrastructure/verification/socket-smtp-probe.js';
import { SmtpRouter } from '../../../infrastructure/verification/smtp-router.js';
import { aggregateVantageEvidence } from '../smtp-classify.js';

function refData(over = {}) {
  return {
    isReservedDomain: over.reserved || (() => false),
    typoSuggestion: over.typo || (() => null),
    isDisposable: over.disposable || (() => false),
    isRole: over.role || (() => false),
  };
}

const healthyDns = {
  resolveDomain: async () => ({
    domainExists: true,
    hasMx: true,
    mxHosts: ['mx1.example.com', 'mx2.example.com', 'mx3.example.com'],
    aRecord: false,
  }),
};
const nullProvider = { verify: async () => ({ deliverable: null, catchAll: false, provider: 'none' }) };

function engineWith({ smtp, ref = refData(), dns = healthyDns, provider = nullProvider }) {
  return new VerificationEngine({
    dnsResolver: dns,
    smtpProbe: smtp,
    getProvider: () => provider,
    referenceData: ref,
  });
}

// ---- 1. Primary MX timeout → secondary MX succeeds -----------------------
test('1) Primary MX timeout → secondary MX succeeds → DELIVERABLE', async () => {
  const calls = [];
  const probe = new SocketSmtpProbe({
    enabled: true,
    from: 'verify@example.com',
    timeoutMs: 500,
    maxRetries: 0,
    domainMinIntervalMs: 0,
    probeFn: async (host, _from, recipients) => {
      calls.push(host);
      if (host === 'mx1.example.com') {
        return { connected: false, rcpt: {}, rcptText: {}, error: 'timeout' };
      }
      const email = recipients[0];
      // Reject the random catch-all probe so this is a real mailbox accept.
      const out = { connected: true, greeting: 220, rcpt: {}, rcptText: {}, error: null };
      for (const r of recipients) {
        out.rcpt[r] = r === email ? 250 : 550;
        out.rcptText[r] = r === email ? 'OK' : 'No such user';
      }
      return out;
    },
  });

  const r = await engineWith({ smtp: probe }).verify('user@example.com');
  assert.deepEqual(calls, ['mx1.example.com', 'mx2.example.com']);
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.DELIVERABLE);
  assert.equal(r.deliverability, DELIVERABILITY.DELIVERABLE);
  assert.equal(r.verificationQuality, VERIFICATION_QUALITY.HIGH);
  assert.ok(r.smtpEvidence?.mxAttempts?.length >= 2);
});

// ---- 2. Definitive 550 → UNDELIVERABLE -----------------------------------
test('2) Definitive 550 → UNDELIVERABLE', async () => {
  const smtp = {
    check: async () => ({
      reachable: true,
      mailboxRejected: true,
      code: 550,
      response: '5.1.1 User unknown',
      smtpClass: 'rejected',
      source: 'smtp-worker',
      mxHost: 'mx.example.com',
    }),
  };
  const r = await engineWith({ smtp }).verify('ghost@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
  assert.equal(r.verificationQuality, VERIFICATION_QUALITY.HIGH);
});

// ---- 3. All MX timeout → UNKNOWN ----------------------------------------
test('3) All MX timeout → UNKNOWN (never invalid)', async () => {
  const probe = new SocketSmtpProbe({
    enabled: true,
    from: 'verify@example.com',
    timeoutMs: 200,
    maxRetries: 0,
    domainMinIntervalMs: 0,
    probeFn: async () => ({ connected: false, rcpt: {}, rcptText: {}, error: 'timeout' }),
  });

  const r = await engineWith({ smtp: probe }).verify('user@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.notEqual(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.notEqual(r.recommendedAction, ACTION.REMOVE);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
  assert.ok(r.smtpEvidence?.finalReason === 'all_mx_unreachable'
    || r.reasons.some((t) => /unconfirmed|handshake/i.test(t)));
});

// ---- 4. Real + random both 250 → ACCEPT_ALL ------------------------------
test('4) Real + random address both 250 → ACCEPT_ALL (not DELIVERABLE)', async () => {
  const probe = new SocketSmtpProbe({
    enabled: true,
    from: 'verify@example.com',
    timeoutMs: 500,
    maxRetries: 0,
    domainMinIntervalMs: 0,
    probeFn: async (_host, _from, recipients) => {
      const out = { connected: true, greeting: 220, rcpt: {}, rcptText: {}, error: null };
      for (const r of recipients) {
        out.rcpt[r] = 250;
        out.rcptText[r] = 'OK';
      }
      return out;
    },
  });

  const r = await engineWith({ smtp: probe }).verify('anyone@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.ACCEPT_ALL);
  assert.equal(r.deliverability, DELIVERABILITY.ACCEPTED);
  assert.notEqual(r.deliverability, DELIVERABILITY.DELIVERABLE);
  // Canonical semantics: catch-all is unconfirmed → REVIEW, not KEEP/safe.
  assert.equal(r.recommendedAction, ACTION.REVIEW);
  assert.equal(r.classification, 'review');
  assert.equal(r.verificationQuality, VERIFICATION_QUALITY.MEDIUM);
  assert.equal(r.deliverabilityScore, 100, 'catch-all must not penalize score');
  assert.ok(r.evidence.some((e) => e.status === 'info' && /catch-all/i.test(e.label)));
  assert.ok(r.smtpEvidence?.catchAll === true || r.riskSignals.some((s) => s.code === 'catch_all'));
});

// ---- 5. Temporary 4xx → UNKNOWN/REVERIFY ---------------------------------
test('5) Temporary 4xx → UNKNOWN / REVERIFY', async () => {
  const smtp = {
    check: async () => ({
      reachable: true,
      temporaryFailure: true,
      greylisted: true,
      code: 450,
      smtpClass: 'temporary',
      source: 'local-smtp',
      mxHost: 'mx.example.com',
    }),
  };
  const r = await engineWith({ smtp }).verify('grey@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNKNOWN);
  assert.equal(r.deliverability, DELIVERABILITY.UNKNOWN);
  assert.equal(r.recommendedAction, ACTION.REVERIFY);
  assert.notEqual(r.recommendedAction, ACTION.REMOVE);
  assert.equal(r.verificationQuality, VERIFICATION_QUALITY.LOW);
});

// ---- 6. Railway timeout + VPS 550 → UNDELIVERABLE ------------------------
test('6) Railway timeout + VPS 550 → UNDELIVERABLE (multi-vantage aggregate)', async () => {
  const local = {
    check: async () => ({
      reachable: false,
      error: 'timeout',
      smtpClass: 'timeout',
      inconclusive: true,
      mxUnreachable: true,
      triedHosts: ['mx.example.com'],
      source: 'local-smtp',
    }),
    selfTest: async () => ({ available: false }),
  };
  const remote = {
    configured: true,
    check: async () => ({
      reachable: true,
      mailboxRejected: true,
      code: 550,
      response: '5.1.1 User unknown',
      smtpClass: 'rejected',
      source: 'smtp-worker',
      workerId: 'smtp-worker-01',
      mxHost: 'mx.example.com',
    }),
    health: async () => ({ available: true }),
    selfTest: async () => ({ available: true, reason: 'ok', detail: 'worker' }),
  };

  const router = new SmtpRouter({ mode: 'auto', local, remote });
  router.setLocalPort25(true); // force trying local first, then aggregate with worker

  const out = await router.check('ghost@example.com', ['mx.example.com']);
  assert.equal(out.mailboxRejected, true);
  assert.equal(out.reachable, true);
  assert.ok(out.smtpEvidence?.vantages?.length >= 2, 'both vantages recorded');
  assert.equal(out.smtpEvidence.finalReason, 'definitive_recipient_rejection');

  const r = await engineWith({ smtp: router }).verify('ghost@example.com');
  assert.equal(r.mailboxStatus, MAILBOX_STATUS.UNDELIVERABLE);
  assert.equal(r.deliverability, DELIVERABILITY.UNDELIVERABLE);
  assert.equal(r.recommendedAction, ACTION.REMOVE);
  assert.ok(r.smtpEvidence?.vantages?.some((v) => v.inconclusive || v.error === 'timeout'));
  assert.ok(r.smtpEvidence?.vantages?.some((v) => v.mailboxRejected));
});

// ---- Aggregation unit sanity ---------------------------------------------
test('aggregateVantageEvidence: timeout + 550 prefers rejection', () => {
  const merged = aggregateVantageEvidence([
    {
      vantage: 'railway-local',
      source: 'local-smtp',
      reachable: false,
      inconclusive: true,
      error: 'timeout',
      triedHosts: ['mx'],
      mxUnreachable: true,
    },
    {
      vantage: 'vps-worker',
      source: 'smtp-worker',
      reachable: true,
      mailboxRejected: true,
      code: 550,
      workerId: 'w1',
    },
  ]);
  assert.equal(merged.mailboxRejected, true);
  assert.equal(merged.smtpEvidence.finalReason, 'definitive_recipient_rejection');
  assert.equal(merged.smtpEvidence.worker?.id, 'w1');
});
