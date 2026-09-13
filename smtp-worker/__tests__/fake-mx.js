// A tiny fake SMTP (MX) server for tests. It speaks just enough of the protocol
// for the worker's conversation: greeting, EHLO, MAIL FROM, RCPT TO, QUIT.
//
// Configure per-recipient RCPT reply codes via `rcptReply(recipient) -> code`.
// Special behaviours: mode 'timeout' (never responds) and 'refuse' (closes).
import net from 'node:net';

export function startFakeMx({ rcptReply, mode } = {}) {
  const server = net.createServer((socket) => {
    if (mode === 'timeout') { return; /* never speak */ }
    if (mode === 'refuse') { socket.destroy(); return; }

    socket.setEncoding('utf8');
    socket.write('220 fake-mx ESMTP ready\r\n');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250 fake-mx\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 OK\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          const m = line.match(/<([^>]*)>/);
          const rcpt = m ? m[1] : '';
          const code = (rcptReply ? rcptReply(rcpt) : 250);
          const msg = code >= 200 && code < 300 ? '2.1.5 OK'
            : code >= 400 && code < 500 ? '4.2.1 try later'
            : '5.1.1 user unknown';
          socket.write(`${code} ${msg}\r\n`);
        } else if (upper.startsWith('QUIT')) {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, host: '127.0.0.1', close: () => new Promise((r) => server.close(r)) });
    });
  });
}
