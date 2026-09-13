// Application entrypoint. Wires the container, builds the HTTP app, starts the
// server, background queue and scheduler, and installs graceful shutdown.
import { assertProductionConfig } from '../config.js';
import { createContainer } from './container.js';
import { buildApp } from './interfaces/http/app.js';
import { loadFeeds } from './infrastructure/verification/feed-loader.js';

export function start() {
  assertProductionConfig();

  const container = createContainer();
  const { config, queue, scheduler, smtpProbe, verifyCapability, referenceData, closeDb } = container;

  // Merge optional external feeds into the reference data.
  loadFeeds(referenceData, config.ROOT);

  const app = buildApp(container);

  const server = app.listen(config.port, () => {
    console.log(`\n  Email List Health Platform (${config.env})`);
    console.log(`  → http://localhost:${config.port}`);
    scheduler.start();
    queue.resume();

    // Tell the operator, honestly, how accurate verification will be here.
    smtpProbe.selfTest().then((r) => {
      verifyCapability.liveSmtp = r.available;
      verifyCapability.smtpDetail = r.detail;
      console.log('\n  ── Verification capability ──');
      if (r.available) {
        console.log('  ✓ LIVE SMTP verification is WORKING — results are real (mailbox-level).');
      } else if (verifyCapability.realProvider) {
        console.log(`  ✓ Using external provider "${verifyCapability.provider}" for mailbox confirmation.`);
        console.log(`  • Live SMTP unavailable: ${r.detail}`);
      } else {
        console.log('  ! Live SMTP is NOT available and no provider is configured.');
        console.log(`    Reason: ${r.detail}`);
        console.log('    → Mailbox existence CANNOT be confirmed here. Addresses that pass');
        console.log('      syntax/DNS/MX will be reported as "unknown", not "safe".');
        console.log('    → For real results: run on a host with outbound port 25 open and set');
        console.log('      SMTP_ENABLED=true, or configure a provider (ZEROBOUNCE_API_KEY).');
      }
      console.log('');
    });
  });

  // ---- Graceful shutdown -------------------------------------------------
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received — shutting down gracefully…`);

    queue.requestStop();
    scheduler.stop();
    server.close(() => console.log('  HTTP server closed'));

    const deadline = Date.now() + 20000;
    while (queue.isRunning() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (closeDb()) console.log('  Database checkpointed and closed');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });

  return { app, server, container };
}
