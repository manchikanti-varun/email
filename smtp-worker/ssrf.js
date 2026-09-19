// SSRF defence-in-depth for the SMTP worker.
//
// The worker legitimately dials arbitrary recipient MX hosts on port 25 — that
// is its job — so MX targets are NOT subject to a public-only allowlist. But a
// compromised caller, a poisoned DNS answer, or a DNS-rebinding attempt could
// point an "MX host" at an internal/loopback/metadata address. This module
// resolves each candidate host and rejects any that map to a private, loopback,
// link-local, or cloud-metadata IP, so the worker can never be used to reach
// internal services on :25. It NEVER relaxes any check on the main server.
import dns from 'node:dns/promises';
import net from 'node:net';

// ---- IP range classification (no external deps) ---------------------------

function isPrivateIPv4(ip) {
  const p = ip.split('.').map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // treat malformed as unsafe
  const [a, b] = p;
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true;         // link-local + metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true;                       // multicast/reserved 224.0.0.0/4+
  return false;
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '::' ) return true;     // loopback / unspecified
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true; // link-local + ULA
  // IPv4-mapped (::ffff:a.b.c.d) — classify by the embedded v4.
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** True when an IP literal is private/loopback/link-local/metadata. */
export function isPrivateIp(ip) {
  if (typeof ip !== 'string' || !ip) return true;
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP literal -> treat as unsafe
}

// Obvious unsafe hostnames (before/without DNS).
export function isUnsafeHostname(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  // Bare IP literals are checked directly.
  if (net.isIP(h)) return isPrivateIp(h);
  if (net.isIP(h.replace(/^\[|\]$/g, ''))) return isPrivateIp(h.replace(/^\[|\]$/g, ''));
  return false;
}

/**
 * Resolve a hostname and decide whether it is safe to connect to.
 * Safe = it resolves to at least one PUBLIC address and none of its resolved
 * addresses are private/loopback/link-local/metadata (fail closed if a host
 * mixes public + private answers, to defeat rebinding).
 * @param {string} host
 * @param {{ resolver?: { lookupAll: (h:string)=>Promise<string[]> } }} [opts]
 *   `resolver.lookupAll` is injectable for tests; defaults to dns.lookup(all).
 * @returns {Promise<{ safe: boolean, reason?: string, addresses: string[] }>}
 */
export async function assertSafeMxHost(host, opts = {}) {
  if (isUnsafeHostname(host)) {
    return { safe: false, reason: 'unsafe_hostname', addresses: [] };
  }
  // An IP literal that passed isUnsafeHostname is already public.
  if (net.isIP(host)) return { safe: true, addresses: [host] };

  const lookupAll = opts.resolver?.lookupAll || defaultLookupAll;
  let addrs;
  try {
    addrs = await lookupAll(host);
  } catch {
    return { safe: false, reason: 'dns_failure', addresses: [] };
  }
  if (!addrs || addrs.length === 0) return { safe: false, reason: 'no_address', addresses: [] };
  const bad = addrs.find((ip) => isPrivateIp(ip));
  if (bad) return { safe: false, reason: 'resolves_to_private_ip', addresses: addrs };
  return { safe: true, addresses: addrs };
}

async function defaultLookupAll(host) {
  const results = await dns.lookup(host, { all: true });
  return results.map((r) => r.address);
}

/**
 * Filter a list of MX hosts to only those safe to connect to.
 * @returns {Promise<{ safe: string[], rejected: Array<{host:string,reason:string}> }>}
 */
export async function filterSafeMxHosts(hosts, opts = {}) {
  const safe = [];
  const rejected = [];
  for (const host of hosts) {
    // eslint-disable-next-line no-await-in-loop
    const r = await assertSafeMxHost(host, opts);
    if (r.safe) safe.push(host);
    else rejected.push({ host, reason: r.reason });
  }
  return { safe, rejected };
}
