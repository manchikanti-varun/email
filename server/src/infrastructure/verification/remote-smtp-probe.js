// RemoteSmtpProbe — an SmtpProbe adapter that delegates the SMTP conversation to
// a MailHealth-owned SMTP worker over HTTPS. This lets the main application run
// on hosts WITHOUT outbound port 25 (Railway, Render, etc.) while still getting
// real mailbox-level evidence from a worker deployed where port 25 is open.
//
// It maps the worker's JSON response back into the exact result shape the
// verification engine already understands, so the engine is unchanged. It NEVER
// turns a transport/worker failure into a negative mailbox verdict — a failure
// is reported as inconclusive (-> engine yields "unknown").
import { SmtpProbe } from '../../domain/ports/index.js';
import {
  classifySmtpCode,
  classifyTransportError,
  SMTP_CLASS,
} from '../../domain/verification/smtp-classify.js';

export class RemoteSmtpProbe extends SmtpProbe {
  /**
   * @param {object} cfg
   * @param {string} cfg.url        base URL of the worker (e.g. https://smtp.example.com)
   * @param {string} cfg.secret     shared bearer secret
   * @param {number} cfg.timeoutMs
   * @param {number} cfg.maxRetries
   * @param {string} cfg.from
   * @param {typeof fetch} [cfg.fetchImpl] injectable for tests
   */
  constructor(cfg) {
    super();
    this.cfg = cfg || {};
    this.fetch = cfg.fetchImpl || globalThis.fetch;
  }

  get configured() { return !!(this.cfg.url && this.cfg.secret); }

  async check(email, mxHosts) {
    if (!this.configured) {
      return {
        reachable: false,
        error: 'worker-not-configured',
        inconclusive: true,
        source: 'none',
        smtpClass: SMTP_CLASS.UNKNOWN,
        vantage: 'vps-worker',
      };
    }
    const hosts = Array.isArray(mxHosts) ? mxHosts.filter(Boolean) : [];
    const mxHost = hosts[0] || undefined;
    const mxHostList = hosts.length ? hosts : undefined;

    let data;
    try {
      data = await this._call({ email, mxHost, mxHosts: mxHostList });
    } catch (e) {
      // Worker unreachable / timeout / error => inconclusive, never invalid.
      const err = e.message || 'worker-error';
      return {
        reachable: false,
        error: err,
        inconclusive: true,
        source: 'none',
        smtpClass: err === 'worker-timeout' ? SMTP_CLASS.TIMEOUT : SMTP_CLASS.UNKNOWN,
        vantage: 'vps-worker',
        mxAttempts: hosts.map((h) => ({ mxHost: h, outcome: 'worker_error', error: err })),
      };
    }

    const smtp = data.smtp || {};
    const status = smtp.status; // accepted|rejected|temporary|catch-all|unknown
    const code = smtp.code ?? null;
    const response = smtp.response || null;
    const smtpClass = status === 'catch-all'
      ? 'catch-all'
      : (status === 'unknown' || smtp.error
        ? (classifyTransportError(smtp.error) || classifySmtpCode(code, response) || SMTP_CLASS.UNKNOWN)
        : (classifySmtpCode(code, response) || status || SMTP_CLASS.UNKNOWN));

    const mxAttempts = Array.isArray(smtp.mxAttempts) && smtp.mxAttempts.length
      ? smtp.mxAttempts
      : (smtp.triedHosts || hosts).map((h) => ({
        mxHost: h,
        outcome: smtp.mxHost === h ? (status || 'tried') : 'tried',
        error: smtp.mxHost === h ? (smtp.error || null) : null,
        code: smtp.mxHost === h ? code : null,
        response: smtp.mxHost === h ? response : null,
      }));

    // Transport-level failure reported by the worker.
    if (status === 'unknown' || smtp.error) {
      return {
        reachable: false,
        error: smtp.error || 'inconclusive',
        inconclusive: true,
        source: 'smtp-worker',
        smtpClass,
        mxUnreachable: true,
        triedHosts: smtp.triedHosts || hosts,
        mxAttempts,
        attempts: smtp.attempts || 0,
        responseTimeMs: smtp.responseTimeMs,
        workerId: data.worker?.id,
        vantage: 'vps-worker',
      };
    }

    const catchAll = status === 'catch-all' || data.catchAll === true;

    return {
      reachable: true,
      // Catch-all must not be reported as mailboxExists (would become DELIVERABLE).
      mailboxExists: status === 'accepted' && !catchAll,
      mailboxRejected: status === 'rejected',
      temporaryFailure: status === 'temporary',
      catchAll,
      code,
      response,
      greylisted: status === 'temporary',
      smtpClass: catchAll ? 'catch-all' : smtpClass,
      source: 'smtp-worker',
      responseTimeMs: smtp.responseTimeMs,
      mxHost: smtp.mxHost,
      triedHosts: smtp.triedHosts,
      mxAttempts,
      attempts: smtp.attempts || 0,
      workerId: data.worker?.id,
      vantage: 'vps-worker',
    };
  }

  async _call({ email, mxHost, mxHosts }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs || 12000);
    const retries = Math.max(0, this.cfg.maxRetries ?? 1);
    let lastErr;
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const body = { email };
          if (mxHosts && mxHosts.length) body.mxHosts = mxHosts;
          else if (mxHost) body.mxHost = mxHost;
          const res = await this.fetch(this.cfg.url.replace(/\/$/, '') + '/internal/verify', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.cfg.secret}`,
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`worker_http_${res.status}`);
          return await res.json();
        } catch (e) {
          lastErr = e;
          if (e.name === 'AbortError') throw new Error('worker-timeout');
          if (attempt < retries) await sleep(200 * (attempt + 1));
        }
      }
      throw lastErr || new Error('worker-error');
    } finally {
      clearTimeout(timer);
    }
  }

  // Worker health probe used by the router to decide availability.
  async health() {
    if (!this.configured) return { available: false, reason: 'not-configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.cfg.timeoutMs || 8000, 8000));
    try {
      const res = await this.fetch(this.cfg.url.replace(/\/$/, '') + '/health', { signal: controller.signal });
      if (!res.ok) return { available: false, reason: `http_${res.status}` };
      const data = await res.json();
      return {
        available: data.status === 'healthy' && data.outboundPort25 !== false,
        outboundPort25: data.outboundPort25,
        workerId: data.workerId,
        activeJobs: data.activeJobs,
      };
    } catch (e) {
      return { available: false, reason: e.name === 'AbortError' ? 'timeout' : (e.message || 'error') };
    } finally {
      clearTimeout(timer);
    }
  }

  async selfTest() {
    const h = await this.health();
    return {
      available: h.available,
      reason: h.available ? 'ok' : (h.reason || 'unavailable'),
      detail: h.available
        ? `worker ${h.workerId || ''} reachable (outbound port 25 ${h.outboundPort25 ? 'open' : 'unknown'})`
        : `worker not available (${h.reason || 'unknown'})`,
    };
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
