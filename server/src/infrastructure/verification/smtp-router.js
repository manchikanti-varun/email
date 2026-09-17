// SmtpRouter — the SMTP capability the engine talks to. It implements the same
// SmtpProbe port, so the engine is unaware of local-vs-remote routing.
//
// Modes (SMTP_MODE):
//   local     — use the local socket probe only (needs outbound port 25 here)
//   remote    — always delegate to the MailHealth SMTP worker
//   auto      — try local; if local is unavailable/inconclusive AND a healthy
//               worker exists, delegate to the worker (DEFAULT)
//   disabled  — perform no SMTP probing at all
//
// Multi-vantage: in `auto`, when local (e.g. Railway) cannot conclude, the
// router also queries the independent VPS worker and AGGREGATES evidence.
// A Railway timeout never overrides a VPS 550 — definitive rejection wins.
//
// Golden rule (enforced here): a transport/infrastructure failure is reported as
// inconclusive, never as a negative mailbox verdict. "unknown stays unknown".
import { SmtpProbe } from '../../domain/ports/index.js';
import { aggregateVantageEvidence } from '../../domain/verification/smtp-classify.js';

const WORKER_HEALTH_TTL_MS = 30_000;

export class SmtpRouter extends SmtpProbe {
  /**
   * @param {object} deps
   * @param {'local'|'remote'|'auto'|'disabled'} deps.mode
   * @param {import('./socket-smtp-probe.js').SocketSmtpProbe} deps.local
   * @param {import('./remote-smtp-probe.js').RemoteSmtpProbe} deps.remote
   * @param {(msg:object)=>void} [deps.log]
   */
  constructor({ mode = 'auto', local, remote, log }) {
    super();
    this.mode = mode;
    this.local = local;
    this.remote = remote;
    this.log = log || (() => {});
    this._workerHealth = { at: 0, available: null };
    // Learned at runtime: whether the local host can actually reach port 25.
    // null = unknown yet; set by the boot self-test or first local attempt.
    this._localPort25 = null;
  }

  setLocalPort25(ok) { this._localPort25 = ok; }

  async _workerAvailable() {
    if (!this.remote || !this.remote.configured) return false;
    if (Date.now() - this._workerHealth.at < WORKER_HEALTH_TTL_MS && this._workerHealth.available !== null) {
      return this._workerHealth.available;
    }
    const h = await this.remote.health();
    this._workerHealth = { at: Date.now(), available: !!h.available };
    return this._workerHealth.available;
  }

  // Marker the engine keys off (existing behaviour): skipped => treated as
  // inconclusive => "unknown".
  _skipped(reason) {
    return {
      skipped: true,
      reachable: null,
      source: 'none',
      reason,
      smtpEvidence: {
        vantages: [{ vantage: 'none', inconclusive: true, error: reason }],
        mxAttempts: [],
        retries: 0,
        catchAll: false,
        finalReason: reason || 'smtp_unavailable',
        worker: null,
      },
    };
  }

  async check(email, mxHosts) {
    if (this.mode === 'disabled') return this._skipped('disabled');

    if (this.mode === 'remote') {
      return this._viaRemote(email, mxHosts);
    }

    if (this.mode === 'local') {
      const r = await this.local.check(email, mxHosts);
      return this._tagLocal(r);
    }

    // ---- auto (multi-vantage) ----
    // If we already know local port 25 is blocked, skip straight to the worker.
    if (this._localPort25 === false) {
      if (await this._workerAvailable()) return this._viaRemote(email, mxHosts);
      // No worker -> honest inconclusive.
      return this._skipped('local-blocked-no-worker');
    }

    // Self-test has not finished yet (_localPort25 === null). Prefer a healthy
    // worker over gambling on a full local timeout per concurrent email.
    if (this._localPort25 === null && this.remote && this.remote.configured) {
      if (await this._workerAvailable()) return this._viaRemote(email, mxHosts);
      // Worker unavailable — fall through and try local.
    }

    const localRes = this._tagLocal(await this.local.check(email, mxHosts));
    localRes.vantage = 'railway-local';

    // Local produced a conclusive answer -> use it (still attach evidence).
    if (this._isConclusive(localRes)) {
      return aggregateVantageEvidence([localRes]);
    }

    // Local inconclusive/blocked -> try the worker if healthy and aggregate.
    if (await this._workerAvailable()) {
      const remoteRes = await this._viaRemote(email, mxHosts);
      remoteRes.vantage = 'vps-worker';
      // Aggregate: Railway timeout + VPS 550 → UNDELIVERABLE (rejection wins).
      return aggregateVantageEvidence([localRes, remoteRes]);
    }

    return aggregateVantageEvidence([localRes]);
  }

  async _viaRemote(email, mxHosts) {
    const r = await this.remote.check(email, mxHosts);
    if (!r.source) r.source = 'smtp-worker';
    r.vantage = r.vantage || 'vps-worker';
    this.log({
      event: 'smtp_route',
      route: 'remote',
      email_domain: domainOf(email),
      reachable: r.reachable,
      source: r.source,
    });
    // Ensure evidence trail even on a single-vantage remote path.
    if (!r.smtpEvidence) {
      return aggregateVantageEvidence([r]);
    }
    return r;
  }

  _tagLocal(r) {
    if (!r) return r;
    if (r.reachable === true && !r.source) r.source = 'local-smtp';
    if (!r.vantage) r.vantage = 'railway-local';
    // Remember that local port 25 is blocked so future calls skip it fast.
    if (r.inconclusive || (r.reachable === false && (r.error === 'timeout' || r.error === 'connection-failed'
      || r.smtpClass === 'timeout' || r.smtpClass === 'connection_refused'))) {
      if (this._localPort25 !== true) this._localPort25 = false;
    } else if (r.reachable === true) {
      this._localPort25 = true;
    }
    return r;
  }

  // "Conclusive" = the probe produced real mailbox evidence (accepted, rejected,
  // catch-all, or a definite temporary/greylist signal). Transport failures and
  // skips are NOT conclusive.
  _isConclusive(r) {
    if (!r || r.skipped || r.inconclusive) return false;
    if (r.reachable !== true) return false;
    return r.mailboxExists || r.mailboxRejected || r.catchAll || r.temporaryFailure;
  }

  async selfTest() {
    if (this.mode === 'disabled') {
      return { available: false, reason: 'disabled', detail: 'SMTP_MODE is disabled', mode: this.mode, source: 'none' };
    }
    if (this.mode === 'remote') {
      const rt = await this.remote.selfTest();
      return { ...rt, mode: this.mode, source: 'smtp-worker' };
    }
    // local or auto: report local capability, and worker as a fallback.
    const lt = await this.local.selfTest();
    this.setLocalPort25(lt.available);
    if (lt.available) {
      return { available: true, reason: 'ok', detail: lt.detail, mode: this.mode, source: 'local-smtp' };
    }
    if (this.mode === 'auto' && this.remote && this.remote.configured) {
      const rt = await this.remote.selfTest();
      if (rt.available) {
        return {
          available: true,
          reason: 'ok',
          detail: `local port 25 blocked; using worker (${rt.detail})`,
          mode: this.mode,
          source: 'smtp-worker',
        };
      }
      return {
        available: false,
        reason: 'no-smtp',
        detail: `local blocked and worker unavailable (${rt.reason})`,
        mode: this.mode,
        source: 'none',
      };
    }
    return { available: false, reason: lt.reason, detail: lt.detail, mode: this.mode, source: 'none' };
  }
}

function domainOf(email) { return (email.split('@')[1] || '').toLowerCase(); }
