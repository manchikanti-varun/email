// DnsResolver adapter using Node's built-in dns/promises. Includes a small
// in-process cache to avoid re-resolving the same domain during a bulk run.
import dns from 'node:dns/promises';
import { DnsResolver } from '../../domain/ports/index.js';

const TTL_MS = 5 * 60 * 1000;

export class NodeDnsResolver extends DnsResolver {
  constructor() {
    super();
    this.cache = new Map();
  }

  _getCached(domain) {
    const hit = this.cache.get(domain);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    return null;
  }
  _setCached(domain, value) {
    this.cache.set(domain, { at: Date.now(), value });
  }

  async resolveDomain(domain) {
    const cached = this._getCached(domain);
    if (cached) return cached;

    const result = { domainExists: false, hasMx: false, mxHosts: [], aRecord: false };

    try {
      const mx = await dns.resolveMx(domain);
      if (mx && mx.length > 0) {
        result.hasMx = true;
        result.domainExists = true;
        result.mxHosts = mx
          .filter((r) => r.exchange)
          .sort((a, b) => a.priority - b.priority)
          .map((r) => r.exchange);
      }
    } catch { /* no MX; fall through */ }

    if (!result.hasMx) {
      try {
        const a = await dns.resolve4(domain);
        if (a && a.length > 0) {
          result.domainExists = true;
          result.aRecord = true;
          result.mxHosts = [domain]; // implicit MX = the domain itself
        }
      } catch { /* no A record either */ }
    }

    this._setCached(domain, result);
    return result;
  }
}
