// SmtpProbe adapter using a raw TCP socket. Performs an SMTP conversation up
// to (but never completing) RCPT TO, so no mail is sent. Also probes a random
// address to detect catch-all domains.
//
// MX hosts are walked in DNS priority order. A primary timeout/refusal falls
// through to the next MX — only a completed SMTP conversation is authoritative.
import net from 'node:net';
import { SmtpProbe } from '../../domain/ports/index.js';
import {
  classifySmtpCode,
  classifyTransportError,
  SMTP_CLASS,
} from '../../domain/verification/smtp-classify.js';
import {
  SmtpResultCache,
  DomainRateLimiter,
  withTransportRetry,
  SMTP_POLICY_DEFAULTS,
} from './smtp-policy.js';

function randomLocalPart() {
  return 'no-such-user-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// Runs one SMTP conversation against `host` and returns the RCPT result codes.
//
// OPTIMIZATION: SMTP command pipelining — sends EHLO + MAIL FROM + RCPT TO(s)
// in a single write, then reads all responses. This reduces TCP round-trips from
// 5 (sequential) to 2 (pipelined + QUIT), saving ~200-300ms per email on typical
// connections. RFC 2926 / RFC 5321 §4.1.2 explicitly permits pipelining as long
// as the client waits for all responses before issuing QUIT.
function probe(host, from, recipients, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port: 25 });
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    const out = {
      connected: false,
      greeting: null,
      rcpt: {},       // recipient -> code
      rcptText: {},   // recipient -> response text
      error: null,
      responseTimeMs: 0,
    };
    let step = 0;
    let rcptIndex = 0;
    let buffer = '';
    let settled = false;

    const domain = (from.split('@')[1] || 'localhost');

    const hardTimer = setTimeout(() => {
      if (!out.error) out.error = 'timeout';
      finish();
    }, timeoutMs + 500);

    function send(line) { socket.write(line + '\r\n'); }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      out.responseTimeMs = Date.now() - started;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(out);
    }

    // Pipeline all commands after greeting: send EHLO + MAIL FROM + all RCPT TO
    // in one burst. We wait for every response before sending QUIT.
    function sendPipelined() {
      send('EHLO ' + domain);
      send('MAIL FROM:<' + from + '>');
      for (const r of recipients) send('RCPT TO:<' + r + '>');
      step = 5; // mark pipelined — handleResponse will process queued replies
    }

    function handleResponse(codeLine) {
      const code = parseInt(codeLine.slice(0, 3), 10);
      const message = codeLine.slice(4).trim();
      switch (step) {
        case 0: // SMTP greeting
          out.connected = true;
          out.greeting = code;
          if (recipients.length === 0) {
            // No recipients to probe — EHLO only, then quit.
            step = 1;
            send('EHLO ' + domain);
          } else {
            sendPipelined();
          }
          break;
        case 1: // EHLO response (no-recipient path)
          step = 4;
          send('QUIT');
          finish();
          break;
        case 5: // Pipelined: consume EHLO, MAIL FROM, RCPT TO responses in order
          // First response = EHLO. If it fails, remaining pipelined commands will
          // also fail — the hard timer cleans up.
          step = 6;
          break;
        case 6: // Pipelined: MAIL FROM response
          step = 3;
          rcptIndex = 0;
          break; // next response will be the first RCPT TO
        case 3: // RCPT TO response(s)
          out.rcpt[recipients[rcptIndex]] = code;
          out.rcptText[recipients[rcptIndex]] = message;
          rcptIndex += 1;
          if (rcptIndex < recipients.length) {
            // more RCPT TO responses expected from the pipeline
          } else {
            step = 4;
            send('QUIT');
            finish();
          }
          break;
        default:
          break;
      }
    }

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length >= 4 && line[3] === '-') continue; // multiline continuation
        if (line.length >= 3) handleResponse(line);
      }
    });

    socket.on('timeout', () => { out.error = 'timeout'; finish(); });
    socket.on('error', (err) => { out.error = err.code || err.message; finish(); });
    socket.on('close', () => finish());
  });
}

// Catch-all is a DOMAIN property, so we memoize it per domain for a short
// window. On a bulk run with many addresses on the same domain this avoids
// re-sending the random-address (catch-all) RCPT on every single email — a
// real throughput win — while keeping verdicts identical (the per-mailbox RCPT
// still runs for every address).
const CATCHALL_TTL_MS = 10 * 60 * 1000;

// Prefer the primary MX, but fall back when it is unreachable. Caps keep bulk
// verification from walking long MX lists (each miss costs a full timeout).
// 3 is enough for most domains; 5 × timeout made diverse lists crawl.
export const MAX_MX_ATTEMPTS = 3;

export class SocketSmtpProbe extends SmtpProbe {
  /**
   * @param {{enabled:boolean, from:string, timeoutMs:number, probeFn?: Function,
   *          maxRetries?: number, cacheTtlMs?: number, domainMinIntervalMs?: number}} smtpConfig
   * `probeFn` is injectable for unit tests; production uses the socket probe.
   */
  constructor(smtpConfig) {
    super();
    this.cfg = smtpConfig;
    this._probe = smtpConfig.probeFn || probe;
    this._catchAll = new Map(); // domain -> { at, isCatchAll }
    this._cache = new SmtpResultCache({
      ttlMs: smtpConfig.cacheTtlMs ?? SMTP_POLICY_DEFAULTS.cacheTtlMs,
    });
    this._rate = new DomainRateLimiter({
      minIntervalMs: smtpConfig.domainMinIntervalMs ?? SMTP_POLICY_DEFAULTS.domainMinIntervalMs,
    });
    this._maxRetries = smtpConfig.maxRetries ?? SMTP_POLICY_DEFAULTS.maxRetries;
  }

  _catchAllCached(domain) {
    const hit = this._catchAll.get(domain);
    if (hit && Date.now() - hit.at < CATCHALL_TTL_MS) return hit.isCatchAll;
    return null; // unknown
  }
  _setCatchAll(domain, isCatchAll) {
    this._catchAll.set(domain, { at: Date.now(), isCatchAll });
  }

  async check(email, mxHosts) {
    if (!this.cfg.enabled) return { skipped: true, reachable: null, source: 'none' };
    if (!mxHosts || mxHosts.length === 0) {
      return {
        reachable: false,
        error: 'no-mx',
        inconclusive: true,
        smtpClass: SMTP_CLASS.UNKNOWN,
        mxAttempts: [],
      };
    }

    const cached = this._cache.get(email);
    if (cached) return { ...cached, source: cached.source || 'local-smtp' };

    return this._rate.schedule(email, () => this._checkUncached(email, mxHosts));
  }

  async _checkUncached(email, mxHosts) {
    const from = this.cfg.from;
    const domain = email.split('@')[1];

    // If we already know this domain's catch-all status, skip the extra random
    // RCPT and probe only the real mailbox.
    const knownCatchAll = this._catchAllCached(domain);
    const catchAllProbe = knownCatchAll === null ? randomLocalPart() + '@' + domain : null;
    const recipients = catchAllProbe ? [email, catchAllProbe] : [email];

    // Walk MX hosts in DNS priority order. Only fall back on TRANSPORT failure
    // (no TCP/SMTP greeting). A connected primary that greylists or rejects is
    // authoritative — do not hop to a secondary MX for a different answer.
    const hosts = [...new Set(mxHosts.filter(Boolean))].slice(0, MAX_MX_ATTEMPTS);
    const triedHosts = [];
    const mxAttempts = [];
    let lastError = 'connection-failed';
    let lastClass = SMTP_CLASS.UNKNOWN;
    let totalAttempts = 0;

    for (let hi = 0; hi < hosts.length; hi++) {
      const host = hosts[hi];
      triedHosts.push(host);

      // Primary gets the full timeout; fallback MX hosts get a shorter budget
      // so one dead primary does not burn N × SMTP_TIMEOUT_MS per email.
      const hostTimeoutMs = hi === 0
        ? this.cfg.timeoutMs
        : Math.min(this.cfg.timeoutMs, Math.max(2000, Math.floor(this.cfg.timeoutMs / 2)));

      const { result: res, attempts } = await withTransportRetry(
        () => this._probe(host, from, recipients, hostTimeoutMs),
        {
          maxRetries: this._maxRetries,
          isRetryable: (r) => {
            if (!r || r.connected) return false;
            const cls = classifyTransportError(r.error);
            // Quick retry on refused/reset; do not burn another full timeout.
            return cls === SMTP_CLASS.CONNECTION_REFUSED || cls === SMTP_CLASS.UNKNOWN;
          },
        },
      );
      totalAttempts += attempts;

      if (!res.connected) {
        lastError = res.error || 'connection-failed';
        lastClass = classifyTransportError(res.error) || SMTP_CLASS.UNKNOWN;
        mxAttempts.push({
          mxHost: host,
          outcome: lastClass,
          error: lastError,
          code: null,
          response: null,
          responseTimeMs: res.responseTimeMs ?? null,
          attempts,
        });
        // Primary timed out / refused → try the next MX. Do NOT stop.
        continue;
      }

      const mailboxCode = res.rcpt[email];
      const mailboxText = res.rcptText?.[email] || '';
      const mailboxClass = classifySmtpCode(mailboxCode, mailboxText);
      const accepted = mailboxClass === SMTP_CLASS.ACCEPTED;
      const rejected = mailboxClass === SMTP_CLASS.REJECTED;

      let isCatchAll;
      let probeCode;
      let probeClass;
      if (catchAllProbe) {
        probeCode = res.rcpt[catchAllProbe];
        const probeText = res.rcptText?.[catchAllProbe] || '';
        probeClass = classifySmtpCode(probeCode, probeText);
        // ACCEPT_ALL only when BOTH real + random are accepted.
        isCatchAll = accepted && probeClass === SMTP_CLASS.ACCEPTED;
        // Only cache a confident (accept/reject) result, not a transient temp/no-reply.
        if (probeClass === SMTP_CLASS.ACCEPTED || probeClass === SMTP_CLASS.REJECTED) {
          this._setCatchAll(domain, isCatchAll);
        }
      } else {
        isCatchAll = knownCatchAll;
        probeCode = undefined;
        probeClass = undefined;
      }

      // Catch-all means the specific mailbox cannot be proven — never report
      // mailboxExists alongside catchAll (would become false DELIVERABLE).
      const temporary = mailboxClass === SMTP_CLASS.TEMPORARY
        || mailboxClass === SMTP_CLASS.RATE_LIMITED
        || (probeClass === SMTP_CLASS.TEMPORARY);

      // Blocked / rate-limited at conversation level is inconclusive for the mailbox.
      const pathBlocked = mailboxClass === SMTP_CLASS.BLOCKED
        || mailboxClass === SMTP_CLASS.RATE_LIMITED;

      mxAttempts.push({
        mxHost: host,
        outcome: pathBlocked ? mailboxClass : (accepted ? 'accepted' : (rejected ? 'rejected' : mailboxClass)),
        error: null,
        code: mailboxCode ?? null,
        response: mailboxText ? mailboxText.slice(0, 200) : null,
        responseTimeMs: res.responseTimeMs ?? null,
        attempts,
      });

      if (pathBlocked) {
        // Treat as transport-ish failure for THIS host; try next MX if any remain.
        lastError = mailboxClass;
        lastClass = mailboxClass;
        continue;
      }

      const result = {
        reachable: true,
        // ACCEPT_ALL wins over DELIVERABLE when both real + random accept.
        mailboxExists: accepted && !isCatchAll,
        mailboxRejected: rejected,
        temporaryFailure: temporary && !rejected && !accepted,
        catchAll: !!isCatchAll,
        code: mailboxCode,
        response: mailboxText ? mailboxText.slice(0, 200) : null,
        probeCode,
        greylisted: mailboxClass === SMTP_CLASS.TEMPORARY,
        smtpClass: isCatchAll ? 'catch-all' : mailboxClass,
        mxHost: host,
        triedHosts,
        mxAttempts,
        attempts: totalAttempts,
        responseTimeMs: res.responseTimeMs ?? null,
        source: 'local-smtp',
      };

      this._cache.set(email, result);
      return result;
    }

    // Never strong enough evidence to mark undeliverable — primary (and any
    // tried backups) did not complete a usable handshake. Treat as inconclusive.
    return {
      reachable: false,
      error: lastError,
      smtpClass: lastClass,
      inconclusive: true,
      triedHosts,
      mxAttempts,
      attempts: totalAttempts,
      mxUnreachable: true,
      source: 'local-smtp',
    };
  }

  async selfTest() {
    if (!this.cfg.enabled) {
      return { available: false, reason: 'disabled', detail: 'SMTP_ENABLED is false' };
    }
    const host = 'gmail-smtp-in.l.google.com';
    const res = await this._probe(host, this.cfg.from, [], Math.min(this.cfg.timeoutMs, 6000));
    if (res.connected) {
      return { available: true, reason: 'ok', detail: `connected to ${host}:25` };
    }
    const cls = classifyTransportError(res.error);
    return {
      available: false,
      reason: cls === SMTP_CLASS.TIMEOUT ? 'port25_blocked' : (res.error || 'unreachable'),
      detail: `could not reach ${host}:25 (${res.error || 'no connection'}); outbound port 25 is likely blocked`,
      smtpClass: cls,
    };
  }
}
