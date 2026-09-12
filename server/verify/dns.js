// DNS + MX resolution using Node's built-in dns/promises (no dependency).
import dns from 'node:dns/promises';

// Simple in-process cache to avoid re-resolving the same domain repeatedly
// during a bulk run. Keyed by domain, expires after TTL.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

function getCached(domain) {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  return null;
}
function setCached(domain, value) {
  cache.set(domain, { at: Date.now(), value });
}

export async function resolveDomain(domain) {
  const cached = getCached(domain);
  if (cached) return cached;

  const result = {
    domainExists: false,
    hasMx: false,
    mxHosts: [],       // sorted by priority
    aRecord: false,
  };

  // MX records are the authoritative signal for mail acceptance.
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
  } catch {
    // no MX; fall through to A/AAAA check
  }

  // A domain with an A record but no MX can still receive mail (implicit MX).
  if (!result.hasMx) {
    try {
      const a = await dns.resolve4(domain);
      if (a && a.length > 0) {
        result.domainExists = true;
        result.aRecord = true;
        result.mxHosts = [domain]; // implicit MX = the domain itself
      }
    } catch {
      // no A record either
    }
  }

  setCached(domain, result);
  return result;
}
