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
import { verifyEmail } from './verify/engine.js';
import { getProvider, providerName, hasRealProvider } from './verify/providers.js';
import { loadFeeds } from './verify/data.js';

loadFeeds();

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

  const useProvider = hasRealProvider();
  console.log(`\nBenchmark — ${dataset.length} labelled addresses`);
  console.log(useProvider
    ? `External provider: ${providerName()} | assumed cost/verify: $${PROVIDER_COST_USD}\n`
    : 'External provider: none (local + live-SMTP engine only)\n');

  const provider = useProvider ? getProvider() : null;
  const results = [];
  const t0 = Date.now();

  for (const item of dataset) {
    const local = await verifyEmail(item.email, { useProvider: false });
    const row = { email: item.email, expected: item.expected, result: local.classification };

    if (provider) {
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
  if (provider) {
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
