// Technical benchmark harness (PDF section 14: measure verification quality
// before significant investment).
//
// Runs a labelled dataset through the verification engine and reports accuracy
// against the labels. If a real external provider is configured, it also runs
// the provider and reports agreement + an estimated cost per verification.
//
// Usage:  node server/benchmark.js [path-to-dataset.json]
//
// Dataset format: [{ "email": "...", "expected": "safe|review|remove|unknown" }, ...]
import fs from 'node:fs';
import { ROOT } from './config.js';
import { VerificationEngine } from './src/domain/verification/engine.js';
import { ReferenceData } from './src/domain/verification/reference-data.js';
import { NodeDnsResolver } from './src/infrastructure/verification/node-dns-resolver.js';
import { SocketSmtpProbe } from './src/infrastructure/verification/socket-smtp-probe.js';
import { selectProvider } from './src/infrastructure/verification/providers.js';
import { loadFeeds } from './src/infrastructure/verification/feed-loader.js';
import { config } from './config.js';

const referenceData = new ReferenceData();
loadFeeds(referenceData, ROOT);

const provider = selectProvider(process.env);
const hasRealProvider = provider.name !== 'none';
const engine = new VerificationEngine({
  dnsResolver: new NodeDnsResolver(),
  smtpProbe: new SocketSmtpProbe(config.smtp),
  getProvider: () => provider,
  referenceData,
});

const PROVIDER_COST_USD = parseFloat(process.env.PROVIDER_COST_PER_VERIFY || '0.004');

function accuracyFor(results, key) {
  let correct = 0;
  for (const r of results) if (r[key] === r.expected) correct++;
  return Math.round((correct / results.length) * 1000) / 10;
}

async function main() {
  const arg = process.argv[2];
  if (!arg || !fs.existsSync(arg)) {
    console.error('\nUsage: node server/benchmark.js <path-to-dataset.json>');
    console.error('Dataset format: [{ "email": "...", "expected": "safe|review|remove|unknown" }, ...]\n');
    process.exit(1);
  }
  const dataset = JSON.parse(fs.readFileSync(arg, 'utf8'));

  console.log(`\nBenchmark — ${dataset.length} labelled addresses`);
  console.log(hasRealProvider
    ? `External provider: ${provider.name} | assumed cost/verify: $${PROVIDER_COST_USD}\n`
    : 'External provider: none (local + live-SMTP engine only)\n');

  const results = [];
  const t0 = Date.now();

  for (const item of dataset) {
    const local = await engine.verify(item.email, { useProvider: false });
    const row = { email: item.email, expected: item.expected, result: local.classification };

    if (hasRealProvider) {
      let providerClass = 'unknown';
      try {
        const p = await provider.verify(item.email, {
          domainExists: !local.reasons.some((r) => /no DNS records/.test(r)),
          catchAll: local.signals.some((s) => /catch-all/i.test(s.label)),
        });
        if (p.deliverable === true) providerClass = 'safe';
        else if (p.deliverable === false) providerClass = 'remove';
        else if (p.catchAll) providerClass = 'review';
      } catch { /* provider unavailable */ }
      row.provider = providerClass;
    }
    results.push(row);
  }

  const elapsed = Date.now() - t0;
  console.table(results);

  console.log('\n── Summary ─────────────────────────────');
  console.log(`Engine accuracy vs labels: ${accuracyFor(results, 'result')}%`);
  if (hasRealProvider) {
    let agree = 0;
    for (const r of results) if (r.result === r.provider) agree++;
    console.log(`Provider accuracy vs labels: ${accuracyFor(results, 'provider')}%`);
    console.log(`Engine/provider agreement:   ${Math.round((agree / results.length) * 1000) / 10}%`);
    console.log(`Est. cost if provider-only:  $${(results.length * PROVIDER_COST_USD).toFixed(4)}`);
  }
  console.log(`Avg time per address:        ${Math.round(elapsed / results.length)} ms`);
  console.log('────────────────────────────────────────\n');

  process.exit(0);
}

main();
