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

    // Learn local port-25 / worker capability BEFORE resuming jobs so auto-mode
    // does not stampede N concurrent local timeouts on the first batch.
    smtpProbe.selfTest().then((r) => {
      verifyCapability.liveSmtp = r.available;
      verifyCapability.smtpDetail = r.detail;
      verifyCapability.smtpSource = r.source || 'none';
      console.log('\n  ── Verification capability ──');
      if (r.available && r.source === 'smtp-worker') {
        console.log('  ✓ SMTP verification via MailHealth WORKER — results are real (mailbox-level).');
        console.log(`  • ${r.detail}`);
      } else if (r.available) {
        console.log('  ✓ LIVE SMTP verification is WORKING (local port 25) — results are real (mailbox-level).');
      } else if (verifyCapability.realProvider) {
        console.log(`  ✓ Using external provider "${verifyCapability.provider}" for mailbox confirmation.`);
        console.log(`  • Live SMTP unavailable: ${r.detail}`);
      } else {
        console.log('  ! SMTP verification is NOT available here.');
        console.log(`    Reason: ${r.detail}`);
        console.log('    → Mailbox existence CANNOT be confirmed. Addresses that pass');
        console.log('      syntax/DNS/MX will be reported as "unknown", not "safe".');
        console.log('    → Fix: deploy the SMTP worker (smtp-worker/) on a host with outbound');
        console.log('      port 25 open and set SMTP_WORKER_URL + SMTP_WORKER_SECRET here.');
      }
      console.log('');
      queue.resume();
    }).catch((err) => {
      console.error('  SMTP self-test failed:', err?.message || err);
      queue.resume();
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
