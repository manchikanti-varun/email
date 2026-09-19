// PHASE 2B.4 — SMTP classification matrix.
//
// Regression tests that lock the exact code→class and transport-error→class
// mappings the audit documented. These assert the CURRENT implementation
// (server/src/domain/verification/smtp-classify.js). They do not change any
// behavior; they pin it so a future edit that (e.g.) turns a timeout into a
// rejection is caught immediately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySmtpCode,
  classifyTransportError,
  isInconclusiveClass,
  toMailboxStatus,
  SMTP_CLASS,
  MAILBOX_STATUS,
} from '../smtp-classify.js';

// ---- Numeric SMTP reply codes ---------------------------------------------
test('2xx codes -> accepted (250, 251)', () => {
  assert.equal(classifySmtpCode(250), SMTP_CLASS.ACCEPTED);
  assert.equal(classifySmtpCode(251), SMTP_CLASS.ACCEPTED);
});

test('4xx codes -> temporary (450, 451, 421 plain)', () => {
  assert.equal(classifySmtpCode(450, 'mailbox busy'), SMTP_CLASS.TEMPORARY);
  assert.equal(classifySmtpCode(451, 'try again'), SMTP_CLASS.TEMPORARY);
  // 421 without rate-limit wording is still temporary in this implementation.
  assert.equal(classifySmtpCode(421, 'service closing'), SMTP_CLASS.TEMPORARY);
});

test('4xx with rate-limit wording -> rate_limited', () => {
  assert.equal(classifySmtpCode(421, '4.7.0 too many connections'), SMTP_CLASS.RATE_LIMITED);
  assert.equal(classifySmtpCode(450, 'rate limit exceeded, slow down'), SMTP_CLASS.RATE_LIMITED);
});

test('5xx recipient codes -> rejected (550..554)', () => {
  for (const [code, text] of [
    [550, '5.1.1 no such user'],
    [551, 'user not local'],
    [552, 'mailbox full'],
    [553, 'mailbox name not allowed'],
    [554, 'no such mailbox'],
  ]) {
    assert.equal(classifySmtpCode(code, text), SMTP_CLASS.REJECTED, `code ${code}`);
  }
});

test('5xx block/blacklist wording (not user-related) -> blocked, NOT rejected', () => {
  assert.equal(classifySmtpCode(554, 'blocked by spamhaus'), SMTP_CLASS.BLOCKED);
  assert.equal(classifySmtpCode(550, 'client host rejected: access denied'), SMTP_CLASS.BLOCKED);
  // But block wording that ALSO mentions the mailbox stays a rejection.
  assert.equal(classifySmtpCode(550, 'user unknown / blacklisted address'), SMTP_CLASS.REJECTED);
});

test('non-numeric / missing code -> no_response', () => {
  assert.equal(classifySmtpCode(undefined), SMTP_CLASS.NO_RESPONSE);
  assert.equal(classifySmtpCode(null), SMTP_CLASS.NO_RESPONSE);
  assert.equal(classifySmtpCode(NaN), SMTP_CLASS.NO_RESPONSE);
});

// ---- Transport-layer errors ------------------------------------------------
test('timeout variants -> timeout', () => {
  assert.equal(classifyTransportError('timeout'), SMTP_CLASS.TIMEOUT);
  assert.equal(classifyTransportError('ETIMEDOUT'), SMTP_CLASS.TIMEOUT);
});

test('connection refused -> connection_refused', () => {
  assert.equal(classifyTransportError('ECONNREFUSED'), SMTP_CLASS.CONNECTION_REFUSED);
});

test('TLS/SSL errors -> tls_failure', () => {
  assert.equal(classifyTransportError('EPROTO'), SMTP_CLASS.TLS_FAILURE);
  assert.equal(classifyTransportError('ERR_TLS_CERT_ALTNAME_INVALID'), SMTP_CLASS.TLS_FAILURE);
  assert.equal(classifyTransportError('ssl handshake failure'), SMTP_CLASS.TLS_FAILURE);
});

test('reset / pipe / network-unreachable errors -> unknown (documented behavior)', () => {
  assert.equal(classifyTransportError('ECONNRESET'), SMTP_CLASS.UNKNOWN);
  assert.equal(classifyTransportError('EPIPE'), SMTP_CLASS.UNKNOWN);
  assert.equal(classifyTransportError('ENETUNREACH'), SMTP_CLASS.UNKNOWN);
  assert.equal(classifyTransportError('EHOSTUNREACH'), SMTP_CLASS.UNKNOWN);
  assert.equal(classifyTransportError('ENOTFOUND'), SMTP_CLASS.UNKNOWN);
});

test('no error -> null', () => {
  assert.equal(classifyTransportError(null), null);
  assert.equal(classifyTransportError(undefined), null);
});

// ---- INVARIANT: every transport/temporary class is inconclusive -----------
// (i.e. never definitive mailbox evidence). This is the "lack of evidence is
// never negative evidence" rule at the classification level.
test('all transport + temporary classes are inconclusive for the mailbox', () => {
  for (const cls of [
    SMTP_CLASS.TIMEOUT,
    SMTP_CLASS.CONNECTION_REFUSED,
    SMTP_CLASS.TLS_FAILURE,
    SMTP_CLASS.RATE_LIMITED,
    SMTP_CLASS.BLOCKED,
    SMTP_CLASS.NO_RESPONSE,
    SMTP_CLASS.UNKNOWN,
    SMTP_CLASS.TEMPORARY,
  ]) {
    assert.equal(isInconclusiveClass(cls), true, `${cls} must be inconclusive`);
  }
  // Accepted / rejected are NOT inconclusive.
  assert.equal(isInconclusiveClass(SMTP_CLASS.ACCEPTED), false);
  assert.equal(isInconclusiveClass(SMTP_CLASS.REJECTED), false);
});

// ---- Application-level mapping (toMailboxStatus) --------------------------
test('toMailboxStatus never turns inconclusive facts into UNDELIVERABLE', () => {
  assert.equal(toMailboxStatus({ temporaryFailure: true }), MAILBOX_STATUS.UNKNOWN);
  assert.equal(toMailboxStatus({ smtpUnavailable: true }), MAILBOX_STATUS.UNKNOWN);
  assert.equal(toMailboxStatus({}), MAILBOX_STATUS.UNKNOWN);
  // Definitive facts still map correctly.
  assert.equal(toMailboxStatus({ mailboxRejected: true }), MAILBOX_STATUS.UNDELIVERABLE);
  assert.equal(toMailboxStatus({ mailboxExists: true }), MAILBOX_STATUS.DELIVERABLE);
  assert.equal(toMailboxStatus({ mailboxExists: true, catchAll: true }), MAILBOX_STATUS.ACCEPT_ALL);
});
