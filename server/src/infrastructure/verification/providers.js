// VerificationProvider adapters (PDF section 11: hybrid architecture).
//
// The engine performs cheap local checks first. When the local result is
// inconclusive, it can defer to an external provider. When no real provider key
// is configured, NullProvider is used — it NEVER fabricates a verdict, always
// returning "unknown" so the platform only reports mailbox conclusions that
// come from a real source (live SMTP or a configured provider).
import https from 'node:https';
import { VerificationProvider } from '../../domain/ports/index.js';

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Bad JSON from provider')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('provider timeout')); });
  });
}

export class NullProvider extends VerificationProvider {
  get name() { return 'none'; }
  async verify() {
    return { deliverable: null, catchAll: false, raw: 'not_configured', provider: 'none' };
  }
}

export class ZeroBounceProvider extends VerificationProvider {
  constructor(apiKey) { super(); this.apiKey = apiKey; }
  get name() { return 'zerobounce'; }
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

export class KickboxProvider extends VerificationProvider {
  constructor(apiKey) { super(); this.apiKey = apiKey; }
  get name() { return 'kickbox'; }
  async verify(email) {
    const url =
      `https://api.kickbox.com/v2/verify?email=${encodeURIComponent(email)}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`;
    const data = await httpGetJson(url);
    const result = (data.result || '').toLowerCase();
    const catchAll = data.reason === 'accepted_email' && result === 'risky';
    let deliverable = null;
    if (result === 'deliverable') deliverable = true;
    else if (result === 'undeliverable') deliverable = false;
    return { deliverable, catchAll, raw: result || 'unknown', provider: this.name };
  }
}

// Chooses a provider from environment. Called once by the container.
export function selectProvider(env = process.env) {
  const which = (env.VERIFY_PROVIDER || '').toLowerCase();
  const zbKey = env.ZEROBOUNCE_API_KEY;
  const kbKey = env.KICKBOX_API_KEY;

  if (which === 'zerobounce' && zbKey) return new ZeroBounceProvider(zbKey);
  if (which === 'kickbox' && kbKey) return new KickboxProvider(kbKey);
  if (zbKey) return new ZeroBounceProvider(zbKey);
  if (kbKey) return new KickboxProvider(kbKey);
  return new NullProvider();
}
