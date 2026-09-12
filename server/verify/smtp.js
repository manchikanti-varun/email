// SMTP mailbox probe using a raw TCP socket. This performs an SMTP
// conversation up to (but never completing) RCPT TO, so no mail is sent.
//
// It also performs catch-all detection by probing a random address that
// almost certainly does not exist: if the server accepts it, the domain
// accepts everything (catch-all) and per-mailbox verification is unreliable.
import net from 'node:net';
import { config } from '../config.js';

function randomLocalPart() {
  return 'no-such-user-' + Math.random().toString(36).slice(2, 12);
}

// Runs one SMTP conversation against `host` and returns the RCPT result codes.
function probe(host, from, recipients, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setEncoding('utf8');
    // Inactivity timeout on an established connection.
    socket.setTimeout(timeoutMs);

    const out = { connected: false, greeting: null, rcpt: {}, error: null };
    // Step machine: 0 greet, 1 EHLO, 2 MAIL FROM, then a RCPT per recipient, QUIT
    let step = 0;
    let rcptIndex = 0;
    let buffer = '';
    let settled = false;

    const domain = (from.split('@')[1] || 'localhost');

    // Hard overall deadline: guarantees we resolve even if the TCP connect
    // itself hangs (common when outbound port 25 is silently dropped).
    const hardTimer = setTimeout(() => {
      if (!out.error) out.error = 'timeout';
      finish();
    }, timeoutMs + 500);

    function send(line) {
      socket.write(line + '\r\n');
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(out);
    }

    function handleResponse(codeLine) {
      const code = parseInt(codeLine.slice(0, 3), 10);
      switch (step) {
        case 0: // greeting
          out.connected = true;
          out.greeting = code;
          step = 1;
          send('EHLO ' + domain);
          break;
        case 1: // EHLO reply
          step = 2;
          send('MAIL FROM:<' + from + '>');
          break;
        case 2: // MAIL FROM reply
          if (recipients.length === 0) {
            // Self-test / connectivity check only — no mailbox to probe.
            step = 4;
            send('QUIT');
            finish();
            break;
          }
          step = 3;
          send('RCPT TO:<' + recipients[rcptIndex] + '>');
          break;
        case 3: // RCPT reply(s)
          out.rcpt[recipients[rcptIndex]] = code;
          rcptIndex += 1;
          if (rcptIndex < recipients.length) {
            send('RCPT TO:<' + recipients[rcptIndex] + '>');
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
      // SMTP responses may be multi-line: "250-..." continuation, "250 " final.
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        // Only act on the final line of a multiline reply (4th char is a space).
        if (line.length >= 4 && line[3] === '-') continue;
        if (line.length >= 3) handleResponse(line);
      }
    });

    socket.on('timeout', () => { out.error = 'timeout'; finish(); });
    socket.on('error', (err) => { out.error = err.code || err.message; finish(); });
    socket.on('close', () => finish());
  });
}

// Returns { reachable, mailboxExists, catchAll, temporaryFailure, error, code }
export async function smtpCheck(email, mxHosts) {
  if (!config.smtp.enabled) {
    return { skipped: true, reachable: null };
  }
  if (!mxHosts || mxHosts.length === 0) {
    return { reachable: false, error: 'no-mx' };
  }

  const host = mxHosts[0];
  const from = config.smtp.from;
  const catchAllProbe = randomLocalPart() + '@' + email.split('@')[1];

  const res = await probe(host, from, [email, catchAllProbe], config.smtp.timeoutMs);

  if (!res.connected) {
    // We could not open an SMTP connection. This is NEVER strong enough
    // evidence to mark an address undeliverable, because the failure is
    // usually our own network (outbound port 25 blocked/filtered) rather than
    // the recipient server being down. Always treat as inconclusive so the
    // address falls back to "unknown", not a false "remove".
    return {
      reachable: false,
      error: res.error || 'connection-failed',
      inconclusive: true,
    };
  }

  const mailboxCode = res.rcpt[email];
  const probeCode = res.rcpt[catchAllProbe];

  const accepts = (c) => typeof c === 'number' && c >= 200 && c < 300;
  const rejects = (c) => typeof c === 'number' && c >= 500 && c < 600;
  const temp = (c) => typeof c === 'number' && c >= 400 && c < 500;

  const catchAll = accepts(probeCode);

  return {
    reachable: true,
    mailboxExists: accepts(mailboxCode),
    mailboxRejected: rejects(mailboxCode),
    temporaryFailure: temp(mailboxCode) || temp(probeCode),
    catchAll,
    code: mailboxCode,
    probeCode,
    greylisted: temp(mailboxCode),
  };
}

// Startup self-check: can we actually open an outbound SMTP (port 25)
// connection? Used to tell the operator whether live verification is really
// working in this environment. Probes a well-known, reliable mail host.
export async function smtpSelfTest() {
  if (!config.smtp.enabled) {
    return { available: false, reason: 'disabled', detail: 'SMTP_ENABLED is false' };
  }
  // gmail-smtp-in is a stable target that responds on port 25.
  const host = 'gmail-smtp-in.l.google.com';
  const res = await probe(host, config.smtp.from, [], Math.min(config.smtp.timeoutMs, 6000));
  if (res.connected) {
    return { available: true, reason: 'ok', detail: `connected to ${host}:25` };
  }
  return {
    available: false,
    reason: res.error === 'timeout' ? 'port25_blocked' : (res.error || 'unreachable'),
    detail: `could not reach ${host}:25 (${res.error || 'no connection'}); outbound port 25 is likely blocked`,
  };
}
