// Pluggable external verification providers (PDF section 11: hybrid architecture).
//
// The engine performs cheap local checks first (syntax, DNS, MX, disposable,
// role, SMTP). When the local result is inconclusive (Unknown / SMTP blocked /
// temporary failure), it can defer to an external provider for a stronger
// signal. Providers implement a single async method:
//
//   verify(email, context) -> {
//     deliverable: true | false | null,   // null = still unknown
//     catchAll: boolean,
//     raw: any,                            // provider's own status string
//     provider: string,
//   }
//
// When no real provider key is configured, a NullProvider is used. It NEVER
// fabricates a verdict — it always returns "unknown" so the platform only ever
// reports mailbox-existence conclusions that come from a real source (live SMTP
// or a configured provider). This keeps results honest.
// Real adapters (ZeroBounce, Kickbox) activate when their API key is present.

import https from 'node:https';

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Bad JSON from provider')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('provider timeout')); });
  });
}

// ---- Null provider (no external verification configured) ------------------
// Does NOT check anything and NEVER guesses. Always returns "unknown" so the
// engine falls back to its real local signals for classification. This is the
// default until a real provider key is supplied.
class NullProvider {
  constructor() { this.name = 'none'; }
  async verify() {
    return { deliverable: null, catchAll: false, raw: 'not_configured', provider: this.name };
  }
}

// ---- ZeroBounce adapter ---------------------------------------------------
class ZeroBounceProvider {
  constructor(apiKey) { this.name = 'zerobounce'; this.apiKey = apiKey; }

  async verify(email) {
    const url =
      `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(this.apiKey)}` +
      `&email=${encodeURIComponent(email)}`;
    const data = await httpGetJson(url);
    const status = (data.status || '').toLowerCase();
    const sub = (data.sub_status || '').toLowerCase();
    const catchAll = status === 'catch-all' || sub === 'catch_all';
    let deliverable = null;
    if (status === 'valid') deliverable = true;
    else if (status === 'invalid') deliverable = false;
    return { deliverable, catchAll, raw: status || 'unknown', provider: this.name };
  }
}

// ---- Kickbox adapter ------------------------------------------------------
class KickboxProvider {
  constructor(apiKey) { this.name = 'kickbox'; this.apiKey = apiKey; }

  async verify(email) {
    const url =
      `https://api.kickbox.com/v2/verify?email=${encodeURIComponent(email)}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`;
    const data = await httpGetJson(url);
    const result = (data.result || '').toLowerCase(); // deliverable|undeliverable|risky|unknown
    const catchAll = data.reason === 'accepted_email' && result === 'risky';
    let deliverable = null;
    if (result === 'deliverable') deliverable = true;
    else if (result === 'undeliverable') deliverable = false;
    return { deliverable, catchAll, raw: result || 'unknown', provider: this.name };
  }
}

// Provider is chosen from env at import time.
function selectProvider() {
  const which = (process.env.VERIFY_PROVIDER || '').toLowerCase();
  const zbKey = process.env.ZEROBOUNCE_API_KEY;
  const kbKey = process.env.KICKBOX_API_KEY;

  if (which === 'zerobounce' && zbKey) return new ZeroBounceProvider(zbKey);
  if (which === 'kickbox' && kbKey) return new KickboxProvider(kbKey);
  // Auto-detect if a key is present without explicit selection.
  if (zbKey) return new ZeroBounceProvider(zbKey);
  if (kbKey) return new KickboxProvider(kbKey);
  // No real provider configured: never fabricate verdicts.
  return new NullProvider();
}

// True when a real external verification provider is active.
export function hasRealProvider() {
  return getProvider().name !== 'none';
}

let active = null;
export function getProvider() {
  if (!active) active = selectProvider();
  return active;
}

export function providerName() {
  return getProvider().name;
}

// Allow tests / benchmark to override.
export function setProvider(p) { active = p; }
