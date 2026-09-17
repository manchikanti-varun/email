// Shared SMTP probe policy: per-domain rate limiting, short-TTL result cache,
// and bounded transport retries. Used by SocketSmtpProbe (and available to the
// router) so bulk runs do not hammer the same MX / domain.

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DOMAIN_MIN_INTERVAL_MS = 80; // ~12.5 probes/sec/domain ceiling
const DEFAULT_MAX_RETRIES = 1;

export class SmtpResultCache {
  constructor({ ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this._map = new Map(); // key -> { at, value }
  }

  _key(email) {
    return String(email || '').toLowerCase();
  }

  get(email) {
    const key = this._key(email);
    const hit = this._map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at >= this.ttlMs) {
      this._map.delete(key);
      return null;
    }
    return hit.value;
  }

  set(email, value) {
    // Only cache conclusive mailbox answers (accepted / rejected / catch-all).
    // Temporary and transport failures must be re-probed.
    if (!value || value.inconclusive || value.skipped) return;
    if (value.temporaryFailure) return;
    if (!(value.mailboxExists || value.mailboxRejected || value.catchAll)) return;
    this._map.set(this._key(email), { at: Date.now(), value: { ...value, cached: true } });
  }

  clear() { this._map.clear(); }
}

export class DomainRateLimiter {
  /**
   * @param {{ minIntervalMs?: number }} [opts]
   * minIntervalMs — minimum gap between probes for the same domain.
   */
  constructor({ minIntervalMs = DEFAULT_DOMAIN_MIN_INTERVAL_MS } = {}) {
    this.minIntervalMs = minIntervalMs;
    this._last = new Map(); // domain -> last start timestamp
    this._tail = new Map(); // domain -> Promise chain tail
  }

  domainOf(email) {
    return String(email || '').split('@')[1]?.toLowerCase() || '';
  }

  /**
   * Serialize probes per domain and enforce a minimum interval so we do not
   * trip provider rate limits during bulk verification.
   */
  async schedule(email, fn) {
    const domain = this.domainOf(email);
    const prev = this._tail.get(domain) || Promise.resolve();
    let result;
    const next = prev
      .catch(() => {}) // keep the chain alive after errors
      .then(async () => {
        const last = this._last.get(domain) || 0;
        const wait = Math.max(0, this.minIntervalMs - (Date.now() - last));
        if (wait > 0) await sleep(wait);
        this._last.set(domain, Date.now());
        result = await fn();
        return result;
      });
    this._tail.set(domain, next);
    try {
      return await next;
    } finally {
      if (this._tail.get(domain) === next) this._tail.delete(domain);
    }
  }
}

/**
 * Retry a probe fn on retryable transport failures only.
 * Never retries a clean SMTP recipient response (accepted/rejected/temporary).
 */
export async function withTransportRetry(fn, {
  maxRetries = DEFAULT_MAX_RETRIES,
  delayMs = 150,
  isRetryable = defaultRetryable,
} = {}) {
  let attempt = 0;
  let last;
  for (;;) {
    last = await fn(attempt);
    attempt += 1;
    if (attempt > maxRetries) break;
    if (!isRetryable(last)) break;
    await sleep(delayMs * attempt);
  }
  return { result: last, attempts: attempt };
}

function defaultRetryable(r) {
  if (!r) return false;
  // Retry only when we never completed an SMTP conversation.
  if (r.reachable === true) return false;
  const err = String(r.error || '').toUpperCase();
  // Timeouts are usually path/firewall — a quick retry rarely helps and burns
  // the full timeout budget. Retry connection resets / refused briefly.
  if (err.includes('TIMEOUT') || err === 'TIMEOUT' || err.includes('ETIMEDOUT')) return false;
  return !!r.error || r.inconclusive === true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const SMTP_POLICY_DEFAULTS = {
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  domainMinIntervalMs: DEFAULT_DOMAIN_MIN_INTERVAL_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
};
