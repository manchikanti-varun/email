import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySmtpCode,
  classifyTransportError,
  toMailboxStatus,
  toVerificationQuality,
  SMTP_CLASS,
  MAILBOX_STATUS,
  VERIFICATION_QUALITY,
} from '../smtp-classify.js';

test('classifySmtpCode: 250 accepted, 550 rejected, 450 temporary', () => {
  assert.equal(classifySmtpCode(250), SMTP_CLASS.ACCEPTED);
  assert.equal(classifySmtpCode(550, '5.1.1 no such user'), SMTP_CLASS.REJECTED);
  assert.equal(classifySmtpCode(450, 'try later'), SMTP_CLASS.TEMPORARY);
});

test('classifySmtpCode: rate limit and blocked from response text', () => {
  assert.equal(classifySmtpCode(421, 'Rate limit exceeded'), SMTP_CLASS.RATE_LIMITED);
  assert.equal(classifySmtpCode(554, 'blocked by spamhaus'), SMTP_CLASS.BLOCKED);
});

test('classifyTransportError maps timeout / refused / tls', () => {
  assert.equal(classifyTransportError('timeout'), SMTP_CLASS.TIMEOUT);
  assert.equal(classifyTransportError('ETIMEDOUT'), SMTP_CLASS.TIMEOUT);
  assert.equal(classifyTransportError('ECONNREFUSED'), SMTP_CLASS.CONNECTION_REFUSED);
  assert.equal(classifyTransportError('ERR_TLS_CERT_ALTNAME_INVALID'), SMTP_CLASS.TLS_FAILURE);
});

test('toMailboxStatus: catch-all wins over exists', () => {
  assert.equal(
    toMailboxStatus({ mailboxExists: true, catchAll: true }),
    MAILBOX_STATUS.ACCEPT_ALL,
  );
  assert.equal(
    toMailboxStatus({ mailboxRejected: true }),
    MAILBOX_STATUS.UNDELIVERABLE,
  );
  assert.equal(
    toMailboxStatus({ temporaryFailure: true }),
    MAILBOX_STATUS.UNKNOWN,
  );
});

test('toVerificationQuality levels', () => {
  assert.equal(toVerificationQuality({ mailboxExists: true }), VERIFICATION_QUALITY.HIGH);
  assert.equal(toVerificationQuality({ catchAll: true }), VERIFICATION_QUALITY.MEDIUM);
  assert.equal(toVerificationQuality({ greylisted: true }), VERIFICATION_QUALITY.LOW);
});
