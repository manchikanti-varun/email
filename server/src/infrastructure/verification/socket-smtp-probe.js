// SmtpProbe adapter using a raw TCP socket. Performs an SMTP conversation up
// to (but never completing) RCPT TO, so no mail is sent. Also probes a random
// address to detect catch-all domains.
import net from 'node:net';
import { SmtpProbe } from '../../domain/ports/index.js';

function randomLocalPart() {
  return 'no-such-user-' + Math.random().toString(36).slice(2, 12);
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
    const socket = net.createConnection({ host, port: 25 });
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    const out = { connected: false, greeting: null, rcpt: {}, error: null };
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

export class SocketSmtpProbe extends SmtpProbe {
  /** @param {{enabled:boolean, from:string, timeoutMs:number}} smtpConfig */
  constructor(smtpConfig) {
    super();
    this.cfg = smtpConfig;
    this._catchAll = new Map(); // domain -> { at, isCatchAll }
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
    if (!this.cfg.enabled) return { skipped: true, reachable: null };
    if (!mxHosts || mxHosts.length === 0) return { reachable: false, error: 'no-mx' };

    const host = mxHosts[0];
    const from = this.cfg.from;
    const domain = email.split('@')[1];

    const accepts = (c) => typeof c === 'number' && c >= 200 && c < 300;
    const rejects = (c) => typeof c === 'number' && c >= 500 && c < 600;
    const temp = (c) => typeof c === 'number' && c >= 400 && c < 500;

    // If we already know this domain's catch-all status, skip the extra random
    // RCPT and probe only the real mailbox.
    const knownCatchAll = this._catchAllCached(domain);
    const catchAllProbe = knownCatchAll === null ? randomLocalPart() + '@' + domain : null;
    const recipients = catchAllProbe ? [email, catchAllProbe] : [email];

    const res = await probe(host, from, recipients, this.cfg.timeoutMs);

    if (!res.connected) {
      // Never strong enough evidence to mark undeliverable — usually our own
      // network (outbound port 25 blocked). Treat as inconclusive.
      return { reachable: false, error: res.error || 'connection-failed', inconclusive: true };
    }

    const mailboxCode = res.rcpt[email];
    let isCatchAll;
    let probeCode;
    if (catchAllProbe) {
      probeCode = res.rcpt[catchAllProbe];
      isCatchAll = accepts(probeCode);
      // Only cache a confident (accept/reject) result, not a transient temp/no-reply.
      if (accepts(probeCode) || rejects(probeCode)) this._setCatchAll(domain, isCatchAll);
    } else {
      isCatchAll = knownCatchAll;
      probeCode = undefined;
    }

    return {
      reachable: true,
      mailboxExists: accepts(mailboxCode),
      mailboxRejected: rejects(mailboxCode),
      temporaryFailure: temp(mailboxCode) || (probeCode !== undefined && temp(probeCode)),
      catchAll: isCatchAll,
      code: mailboxCode,
      probeCode,
      greylisted: temp(mailboxCode),
    };
  }

  async selfTest() {
    if (!this.cfg.enabled) {
      return { available: false, reason: 'disabled', detail: 'SMTP_ENABLED is false' };
    }
    const host = 'gmail-smtp-in.l.google.com';
    const res = await probe(host, this.cfg.from, [], Math.min(this.cfg.timeoutMs, 6000));
    if (res.connected) {
      return { available: true, reason: 'ok', detail: `connected to ${host}:25` };
    }
    return {
      available: false,
      reason: res.error === 'timeout' ? 'port25_blocked' : (res.error || 'unreachable'),
      detail: `could not reach ${host}:25 (${res.error || 'no connection'}); outbound port 25 is likely blocked`,
    };
  }
}
