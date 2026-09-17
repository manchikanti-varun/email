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
    if (!this.configured) return { reachable: false, error: 'worker-not-configured', inconclusive: true, source: 'none' };
    const hosts = Array.isArray(mxHosts) ? mxHosts.filter(Boolean) : [];
    const mxHost = hosts[0] || undefined;
    const mxHostList = hosts.length ? hosts : undefined;

    let data;
    try {
      data = await this._call({ email, mxHost, mxHosts: mxHostList });
    } catch (e) {
      // Worker unreachable / timeout / error => inconclusive, never invalid.
      return { reachable: false, error: e.message || 'worker-error', inconclusive: true, source: 'none' };
    }

    const smtp = data.smtp || {};
    const status = smtp.status; // accepted|rejected|temporary|catch-all|unknown

    // Transport-level failure reported by the worker.
    if (status === 'unknown' || smtp.error) {
      return {
        reachable: false,
        error: smtp.error || 'inconclusive',
        inconclusive: true,
        source: 'smtp-worker',
        mxUnreachable: true,
        triedHosts: smtp.triedHosts || hosts,
      };
    }

    return {
      reachable: true,
      mailboxExists: status === 'accepted',
      mailboxRejected: status === 'rejected',
      temporaryFailure: status === 'temporary',
      catchAll: status === 'catch-all' || data.catchAll === true,
      code: smtp.code ?? null,
      greylisted: status === 'temporary',
      source: 'smtp-worker',
      responseTimeMs: smtp.responseTimeMs,
      mxHost: smtp.mxHost,
      triedHosts: smtp.triedHosts,
      workerId: data.worker?.id,
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
