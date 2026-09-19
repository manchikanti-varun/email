// PHASE 2B.8 — SMTP command-safety invariant (CRITICAL).
//
// The probe must perform ONLY: EHLO -> MAIL FROM -> RCPT TO(s) -> QUIT.
// It must NEVER issue DATA or transmit a message body. This test records every
// line written to the socket by the real smtpConversation() and fails if a
// DATA command (or anything resembling a message body) is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { smtpConversation } from '../smtp-probe.js';

// A recording MX that captures every client line and answers just enough of the
// protocol to walk EHLO/MAIL FROM/RCPT TO/QUIT.
function startRecordingMx({ rcptReply = () => 250 } = {}) {
  const received = [];
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 rec-mx ESMTP\r\n');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        received.push(line);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250 rec-mx\r\n');
        else if (upper.startsWith('MAIL FROM')) socket.write('250 2.1.0 OK\r\n');
        else if (upper.startsWith('RCPT TO')) {
          const m = line.match(/<([^>]*)>/);
          socket.write(`${rcptReply(m ? m[1] : '')} 2.1.5 OK\r\n`);
        } else if (upper.startsWith('QUIT')) { socket.write('221 bye\r\n'); socket.end(); }
        else if (upper.startsWith('DATA')) socket.write('354 end with .\r\n'); // would only matter if the client ever sent DATA
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      received, port: server.address().port, host: '127.0.0.1',
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

test('conversation issues only EHLO/MAIL FROM/RCPT TO/QUIT — never DATA or a body', async () => {
  const mx = await startRecordingMx({ rcptReply: () => 250 });
  await smtpConversation(mx.host, {
    from: 'verify@example.com', ehlo: 'mailhealth.verify',
    recipients: ['real@example.com', 'random-xyz@example.com'],
    timeoutMs: 2000, port: mx.port,
  });
  await mx.close();

  const cmds = mx.received.map((l) => l.toUpperCase());
  // Positive: the expected verbs appear.
  assert.ok(cmds.some((l) => l.startsWith('EHLO')), 'EHLO sent');
  assert.ok(cmds.some((l) => l.startsWith('MAIL FROM')), 'MAIL FROM sent');
  assert.ok(cmds.filter((l) => l.startsWith('RCPT TO')).length === 2, 'two RCPT TO sent');
  assert.ok(cmds.some((l) => l.startsWith('QUIT')), 'QUIT sent');

  // CRITICAL negative: no DATA command, ever.
  assert.ok(!cmds.some((l) => l === 'DATA' || l.startsWith('DATA')), 'DATA must never be sent');

  // CRITICAL negative: only the allowed verbs were written (no body lines).
  const ALLOWED = /^(EHLO|HELO|MAIL FROM|RCPT TO|QUIT)\b/;
  const stray = mx.received.filter((l) => l.length > 0 && !ALLOWED.test(l.toUpperCase()));
  assert.deepEqual(stray, [], `no unexpected lines should be written, saw: ${JSON.stringify(stray)}`);
});

test('no-recipient conversation (self-test) still never sends DATA', async () => {
  const mx = await startRecordingMx();
  await smtpConversation(mx.host, {
    from: 'verify@example.com', ehlo: 'mailhealth.verify',
    recipients: [], timeoutMs: 2000, port: mx.port,
  });
  await mx.close();
  const cmds = mx.received.map((l) => l.toUpperCase());
  assert.ok(!cmds.some((l) => l.startsWith('DATA')), 'DATA must never be sent');
  assert.ok(cmds.some((l) => l.startsWith('EHLO')), 'EHLO sent');
});
