// Pure SMTP outcome classification and mailbox/quality mapping.
//
// Core rule: transport/network failures are NEVER mailbox evidence.
// Only a completed SMTP conversation with a definitive RCPT response can
// prove DELIVERABLE, UNDELIVERABLE, or ACCEPT_ALL.

export const MAILBOX_STATUS = {
  DELIVERABLE: 'DELIVERABLE',
  UNDELIVERABLE: 'UNDELIVERABLE',
  ACCEPT_ALL: 'ACCEPT_ALL',
  UNKNOWN: 'UNKNOWN',
};

export const VERIFICATION_QUALITY = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

/** Normalized SMTP / transport outcome classes. */
export const SMTP_CLASS = {
  ACCEPTED: 'accepted',           // 250 RCPT accepted
  REJECTED: 'rejected',           // definitive 5xx recipient rejection
  TEMPORARY: 'temporary',         // 4xx temporary / greylist
  TIMEOUT: 'timeout',
  CONNECTION_REFUSED: 'connection_refused',
  TLS_FAILURE: 'tls_failure',
  RATE_LIMITED: 'rate_limited',
  BLOCKED: 'blocked',             // provider blocked the probing host
  NO_RESPONSE: 'no_response',
  UNKNOWN: 'unknown',
};

const RATE_LIMIT_RE = /rate\s*limit|too many|try again later|slow down|throttl|421[\s.-]*4\.7|450[\s.-]*4\.7/i;
const BLOCKED_RE = /blocked|blacklist|blacklisted|banned|not allowed|access denied|spamhaus|rbl|client host rejected|suspicious/i;
const TLS_RE = /tls|ssl|starttls|certificate|handshake failure/i;

/**
 * Classify a numeric SMTP reply code, optionally using the response text for
 * rate-limit / blocked nuance.
 * @returns {string} SMTP_CLASS value
 */
export function classifySmtpCode(code, responseText = '') {
  if (typeof code !== 'number' || !Number.isFinite(code)) return SMTP_CLASS.NO_RESPONSE;
  const text = String(responseText || '');

  if (code >= 200 && code < 300) return SMTP_CLASS.ACCEPTED;

  if (code >= 400 && code < 500) {
    if (RATE_LIMIT_RE.test(text) || code === 421) {
      // 421 often means "service not available / closing" due to rate or policy.
      if (RATE_LIMIT_RE.test(text) || /too many|throttl/i.test(text)) {
        return SMTP_CLASS.RATE_LIMITED;
      }
    }
    return SMTP_CLASS.TEMPORARY;
  }

  if (code >= 500 && code < 600) {
    // Policy/block responses are about OUR connection, not the mailbox.
    if (BLOCKED_RE.test(text) && !/user|mailbox|recipient|no such|doesn't exist|unknown|invalid/i.test(text)) {
      return SMTP_CLASS.BLOCKED;
    }
    if (RATE_LIMIT_RE.test(text)) return SMTP_CLASS.RATE_LIMITED;
    return SMTP_CLASS.REJECTED;
  }

  return SMTP_CLASS.UNKNOWN;
}

/**
 * Classify a transport-layer error from the socket / TLS stack.
 * These never prove the mailbox invalid.
 */
export function classifyTransportError(error) {
  if (!error) return null;
  const e = String(error);
  const upper = e.toUpperCase();

  if (upper === 'TIMEOUT' || upper.includes('ETIMEDOUT') || upper.includes('TIMEOUT')) {
    return SMTP_CLASS.TIMEOUT;
  }
  if (upper.includes('ECONNREFUSED') || upper.includes('REFUSED')) {
    return SMTP_CLASS.CONNECTION_REFUSED;
  }
  if (
    upper.includes('EPROTO') ||
    upper.includes('CERT') ||
    upper.includes('SSL') ||
    upper.includes('TLS') ||
    TLS_RE.test(e)
  ) {
    return SMTP_CLASS.TLS_FAILURE;
  }
  if (upper.includes('ECONNRESET') || upper.includes('EPIPE') || upper.includes('ENETUNREACH')
    || upper.includes('EHOSTUNREACH') || upper.includes('ENOTFOUND')) {
    return SMTP_CLASS.UNKNOWN;
  }
  return SMTP_CLASS.UNKNOWN;
}

/** True when the class is about the connection/path, not the mailbox. */
export function isInconclusiveClass(cls) {
  return cls === SMTP_CLASS.TIMEOUT
    || cls === SMTP_CLASS.CONNECTION_REFUSED
    || cls === SMTP_CLASS.TLS_FAILURE
    || cls === SMTP_CLASS.RATE_LIMITED
    || cls === SMTP_CLASS.BLOCKED
    || cls === SMTP_CLASS.NO_RESPONSE
    || cls === SMTP_CLASS.UNKNOWN
    || cls === SMTP_CLASS.TEMPORARY;
}

/** True when the class is definitive mailbox evidence. */
export function isDefinitiveMailboxClass(cls) {
  return cls === SMTP_CLASS.ACCEPTED
    || cls === SMTP_CLASS.REJECTED
    || cls === SMTP_CLASS.ACCEPTED; // catch-all handled separately
}

/**
 * Map SMTP probe facts → mailboxStatus (what can be proven about the mailbox).
 * Accepts either `mailboxExists` or engine `mailboxConfirmed`.
 */
export function toMailboxStatus({
  mailboxRejected = false,
  mailboxExists = false,
  mailboxConfirmed = false,
  catchAll = false,
  temporaryFailure = false,
  smtpUnavailable = false,
} = {}) {
  if (mailboxRejected) return MAILBOX_STATUS.UNDELIVERABLE;
  if (catchAll) return MAILBOX_STATUS.ACCEPT_ALL;
  if (mailboxExists || mailboxConfirmed) return MAILBOX_STATUS.DELIVERABLE;
  // temporary / unavailable / unknown all stay unproven
  void temporaryFailure;
  void smtpUnavailable;
  return MAILBOX_STATUS.UNKNOWN;
}

/**
 * Evidence strength — independent of the mailbox verdict.
 * HIGH only when we have a definitive SMTP mailbox answer (or catch-all proof).
 * Accepts either `mailboxExists` or engine `mailboxConfirmed`.
 */
export function toVerificationQuality({
  mailboxRejected = false,
  mailboxExists = false,
  mailboxConfirmed = false,
  catchAll = false,
  greylisted = false,
  smtpUnavailable = false,
  hasMx = false,
  multiVantageAgree = false,
} = {}) {
  void multiVantageAgree;
  if (mailboxRejected || mailboxExists || mailboxConfirmed) {
    return VERIFICATION_QUALITY.HIGH;
  }
  if (catchAll) return VERIFICATION_QUALITY.MEDIUM;
  if (greylisted) return VERIFICATION_QUALITY.LOW;
  if (smtpUnavailable) return hasMx ? VERIFICATION_QUALITY.MEDIUM : VERIFICATION_QUALITY.LOW;
  return VERIFICATION_QUALITY.LOW;
}

/**
 * Aggregate evidence from multiple vantages (e.g. Railway local + VPS worker).
 *
 * Preference order for the FINAL mailbox conclusion:
 *   1. Any definitive rejection (5xx) → UNDELIVERABLE
 *   2. Any catch-all proof → ACCEPT_ALL
 *   3. Any acceptance without catch-all → DELIVERABLE
 *   4. Any temporary (4xx) → UNKNOWN (reverify)
 *   5. Else → UNKNOWN
 *
 * Transport failures from one vantage never override a conclusive answer from
 * another. A Railway timeout + VPS 550 must yield UNDELIVERABLE.
 *
 * @param {Array<object>} vantageResults  probe results tagged with `vantage`
 * @returns {object} merged probe-shaped result + smtpEvidence
 */
export function aggregateVantageEvidence(vantageResults = []) {
  const attempts = [];
  const vantages = [];

  for (const r of vantageResults) {
    if (!r) continue;
    const vantage = r.vantage || r.source || 'unknown';
    vantages.push({
      vantage,
      source: r.source || null,
      reachable: r.reachable,
      inconclusive: !!r.inconclusive || !!r.skipped,
      mailboxExists: !!r.mailboxExists,
      mailboxRejected: !!r.mailboxRejected,
      temporaryFailure: !!r.temporaryFailure,
      catchAll: !!r.catchAll,
      code: r.code ?? null,
      error: r.error || null,
      smtpClass: r.smtpClass || null,
      mxHost: r.mxHost || null,
      triedHosts: r.triedHosts || [],
      workerId: r.workerId || null,
      responseTimeMs: r.responseTimeMs ?? null,
    });
    if (Array.isArray(r.mxAttempts)) {
      for (const a of r.mxAttempts) attempts.push({ ...a, vantage });
    } else if (Array.isArray(r.triedHosts)) {
      for (const h of r.triedHosts) {
        attempts.push({
          vantage,
          mxHost: h,
          outcome: r.mxHost === h && r.reachable ? 'connected' : 'tried',
          error: r.mxHost === h ? null : (r.error || null),
          code: r.mxHost === h ? (r.code ?? null) : null,
        });
      }
    }
  }

  const conclusive = vantageResults.filter((r) => r && !r.skipped && !r.inconclusive && r.reachable === true);
  const rejected = conclusive.find((r) => r.mailboxRejected);
  const catchAllHit = conclusive.find((r) => r.catchAll);
  const accepted = conclusive.find((r) => r.mailboxExists && !r.catchAll);
  const temporary = conclusive.find((r) => r.temporaryFailure);

  let winner = null;
  let finalReason = 'no_conclusive_smtp_evidence';

  if (rejected) {
    winner = rejected;
    finalReason = 'definitive_recipient_rejection';
  } else if (catchAllHit) {
    winner = catchAllHit;
    finalReason = 'catch_all_domain';
  } else if (accepted) {
    winner = accepted;
    finalReason = 'mailbox_accepted';
  } else if (temporary) {
    winner = temporary;
    finalReason = 'temporary_failure';
  } else {
    // Prefer the most informative inconclusive result (one that tried hosts).
    winner = vantageResults.find((r) => r && (r.mxUnreachable || r.triedHosts?.length))
      || vantageResults.find((r) => r && r.inconclusive)
      || vantageResults.find((r) => r && r.skipped)
      || { reachable: false, inconclusive: true, skipped: true, source: 'none' };
    finalReason = winner.mxUnreachable
      ? 'all_mx_unreachable'
      : (winner.skipped ? 'smtp_unavailable' : 'transport_or_network_failure');
  }

  const agreeing = conclusive.filter((r) => {
    if (rejected) return r.mailboxRejected;
    if (catchAllHit) return r.catchAll;
    if (accepted) return r.mailboxExists && !r.catchAll;
    return false;
  });

  const smtpEvidence = {
    vantages,
    mxAttempts: attempts,
    retries: vantageResults.reduce((n, r) => n + (r.attempts || r.retries || 0), 0),
    catchAll: !!(winner && winner.catchAll),
    finalReason,
    worker: winner?.workerId
      ? { id: winner.workerId }
      : (vantages.find((v) => v.workerId)?.workerId
        ? { id: vantages.find((v) => v.workerId).workerId }
        : null),
  };

  return {
    ...winner,
    // Preserve multi-vantage trail even when a single winner is selected.
    source: winner.source || null,
    smtpEvidence,
    multiVantageAgree: agreeing.length >= 2,
    vantageCount: vantages.length,
  };
}
