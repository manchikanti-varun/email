// Core SMTP conversation. Opens a TCP socket to the recipient MX on port 25 and
// runs EHLO -> MAIL FROM -> RCPT TO -> QUIT. It NEVER sends a message body and
// never delivers mail. It records structured evidence about the RCPT response.
//
// This is the piece that requires outbound port 25 — which is exactly why it
// lives in the worker and not in the main app.
import net from 'node:net';

// One SMTP conversation against `host`, probing the given recipients in order.
// Returns raw evidence: connection state, greeting code, per-recipient RCPT
// codes + messages, timing, and any transport error code.
export function smtpConversation(host, { from, ehlo, recipients, timeoutMs, port = 25 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = {
      connected: false,
      greeting: null,
      rcpt: {},         // { recipient: { code, message } }
      error: null,      // transport-level error code (ETIMEDOUT, ECONNREFUSED, ...)
      responseTimeMs: 0,
      mxHost: host,
    };

    let socket;
    try {
      socket = net.createConnection({ host, port });
    } catch (e) {
      out.error = e.code || e.message;
      out.responseTimeMs = Date.now() - started;
      return resolve(out);
    }
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    let step = 0;
    let rcptIndex = 0;
    let buffer = '';
    let settled = false;

    const hardTimer = setTimeout(() => {
      if (!out.error) out.error = 'timeout';
      finish();
    }, timeoutMs + 500);

    const send = (line) => { try { socket.write(line + '\r\n'); } catch { /* ignore */ } };

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      out.responseTimeMs = Date.now() - started;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(out);
    }

    function handle(line) {
      const code = parseInt(line.slice(0, 3), 10);
      const message = line.slice(4).trim();
      switch (step) {
        case 0: // greeting
          out.connected = true;
          out.greeting = code;
          step = 1;
          send('EHLO ' + ehlo);
          break;
        case 1: // EHLO response
          step = 2;
          send('MAIL FROM:<' + from + '>');
          break;
        case 2: // MAIL FROM response
          if (recipients.length === 0) { step = 4; send('QUIT'); finish(); break; }
          step = 3;
          send('RCPT TO:<' + recipients[rcptIndex] + '>');
          break;
        case 3: // RCPT TO response
          out.rcpt[recipients[rcptIndex]] = { code, message };
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
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        // Skip multiline continuation lines ("250-...").
        if (line.length >= 4 && line[3] === '-') continue;
        if (line.length >= 3) handle(line);
      }
    });

    socket.on('timeout', () => { if (!out.error) out.error = 'timeout'; finish(); });
    socket.on('error', (err) => { if (!out.error) out.error = err.code || err.message; finish(); });
    socket.on('close', () => finish());
  });
}

const RATE_LIMIT_RE = /rate\s*limit|too many|try again later|slow down|throttl/i;
const BLOCKED_RE = /blocked|blacklist|blacklisted|banned|not allowed|access denied|spamhaus|rbl|client host rejected|suspicious/i;

// Classify a single RCPT code into a normalized SMTP status.
// When response text is available, distinguish rate_limited / blocked from a
// plain temporary or recipient rejection.
export function classifyCode(code, responseText = '') {
  if (typeof code !== 'number') return 'no_response';
  const text = String(responseText || '');
  if (code >= 200 && code < 300) return 'accepted';
  if (code >= 400 && code < 500) {
    if (RATE_LIMIT_RE.test(text)) return 'rate_limited';
    return 'temporary';
  }
  if (code >= 500 && code < 600) {
    if (BLOCKED_RE.test(text) && !/user|mailbox|recipient|no such|doesn't exist|unknown|invalid/i.test(text)) {
      return 'blocked';
    }
    if (RATE_LIMIT_RE.test(text)) return 'rate_limited';
    return 'rejected';
  }
  return 'unknown';
}

// True transport failures — evidence about the CONNECTION, never about the
// mailbox. The router/engine must treat these as "unknown", not "invalid".
export function isTransportFailure(error) {
  return !!error; // any transport error code means we could not converse
}

/** Normalize a socket/transport error into a stable class. */
export function classifyTransportError(error) {
  if (!error) return null;
  const e = String(error).toUpperCase();
  if (e === 'TIMEOUT' || e.includes('ETIMEDOUT') || e.includes('TIMEOUT')) return 'timeout';
  if (e.includes('ECONNREFUSED') || e.includes('REFUSED')) return 'connection_refused';
  if (e.includes('EPROTO') || e.includes('CERT') || e.includes('SSL') || e.includes('TLS')) return 'tls_failure';
  return 'unknown';
}
