#!/usr/bin/env node
// Export a CALIBRATION TRAINING DATASET by joining independent ground-truth
// labels with verification evidence already stored in the contacts table.
//
// The calibrator learns P(engine verdict correct | evidence). That requires an
// INDEPENDENT groundTruth — never the engine copying its own deliverability.
// Copying high-confidence SMTP verdicts as labels yields an all-positive set
// (label=1 everywhere) and cannot train a useful model.
//
// Valid label sources (see GROUND_TRUTH_SOURCE in dataset.js):
//   GROUND_TRUTH  — seed / known-good / known-bad / controlled test mailboxes
//   REFERENCE     — established external provider or bounce/ESP outcome
//   HEURISTIC     — repeated independent agreement (use sparingly)
//
// Usage:
//   node scripts/export-calibration-dataset.mjs --labels labels.json [--out dataset.json]
//   node scripts/export-calibration-dataset.mjs --known-good good.txt --known-bad bad.txt
//   node scripts/export-calibration-dataset.mjs --labels labels.json --list <listId>
//
// Then:
//   node scripts/train-calibration.mjs dataset.json
//   node scripts/train-calibration.mjs dataset.json --deploy

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_SOURCES = new Set(['GROUND_TRUTH', 'REFERENCE', 'HEURISTIC']);
const VALID_TRUTHS = new Set(['deliverable', 'undeliverable', 'risky', 'unknown']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || true);
}

function safeParse(v, fallback) {
  try { return JSON.parse(v || ''); } catch { return fallback; }
}

function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function readEmailList(filePath, groundTruth) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const email = normalizeEmail(line.replace(/#.*$/, ''));
    if (!email || !email.includes('@')) continue;
    out.push({
      email,
      groundTruth,
      groundTruthSource: 'GROUND_TRUTH',
    });
  }
  return out;
}

function loadLabels({ labelsPath, knownGoodPath, knownBadPath }) {
  const byEmail = new Map();

  const add = (item, origin) => {
    const email = normalizeEmail(item.email);
    if (!email) {
      console.warn(`  skip (${origin}): missing email`);
      return;
    }
    const groundTruth = String(item.groundTruth || '').toLowerCase();
    const groundTruthSource = String(item.groundTruthSource || '').toUpperCase();
    if (!VALID_TRUTHS.has(groundTruth)) {
      console.warn(`  skip ${email}: invalid groundTruth "${item.groundTruth}"`);
      return;
    }
    if (!VALID_SOURCES.has(groundTruthSource)) {
      console.warn(`  skip ${email}: invalid groundTruthSource "${item.groundTruthSource}" (need GROUND_TRUTH|REFERENCE|HEURISTIC)`);
      return;
    }
    byEmail.set(email, {
      email,
      groundTruth,
      groundTruthSource,
      referenceVerdict: item.referenceVerdict || undefined,
      previousVerdict: item.previousVerdict || undefined,
    });
  };

  if (labelsPath) {
    if (!fs.existsSync(labelsPath)) {
      console.error(`Labels file not found: ${labelsPath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    if (!Array.isArray(raw)) {
      console.error('Labels file must be a JSON array of {email, groundTruth, groundTruthSource, ...}');
      process.exit(1);
    }
    for (const item of raw) add(item, 'labels');
  }

  if (knownGoodPath) {
    if (!fs.existsSync(knownGoodPath)) {
      console.error(`Known-good file not found: ${knownGoodPath}`);
      process.exit(1);
    }
    for (const item of readEmailList(knownGoodPath, 'deliverable')) add(item, 'known-good');
  }

  if (knownBadPath) {
    if (!fs.existsSync(knownBadPath)) {
      console.error(`Known-bad file not found: ${knownBadPath}`);
      process.exit(1);
    }
    for (const item of readEmailList(knownBadPath, 'undeliverable')) add(item, 'known-bad');
  }

  return byEmail;
}

function contactToResult(row) {
  return {
    email: row.email,
    deliverability: row.deliverability,
    deliverabilityScore: row.score,
    confidence: row.confidence,
    recommendedAction: row.recommended_action,
    classification: row.classification,
    status: row.status,
    score: row.score,
    greylisted: !!row.greylisted,
    provider: row.provider || null,
    signals: safeParse(row.signals, []),
    riskSignals: safeParse(row.risk_signals, []),
    verified_at: row.verified_at,
  };
}

function usage() {
  console.error(`
Usage:
  node scripts/export-calibration-dataset.mjs --labels labels.json [--out dataset.json] [--list <listId>]
  node scripts/export-calibration-dataset.mjs labels.json [out.json]
  node scripts/export-calibration-dataset.mjs --known-good good.txt --known-bad bad.txt [--out dataset.json]

  # Prefer calling node directly (npm may swallow --labels / --out on some versions):
  node scripts/export-calibration-dataset.mjs --labels scripts/labels.example.json --out calibration-dataset.json

Labels must be INDEPENDENT of the engine verdict (seed mailboxes, bounce/ESP
outcomes, manual review, provider REFERENCE). Never copy deliverability as GT.

Then:
  node scripts/train-calibration.mjs <dataset.json> [--deploy]
`);
}

// Positional fallback: <labels.json> [out.json]
// npm on Windows often eats --labels/--out as its own config flags.
const positionals = process.argv.slice(2).filter((a) => a && !a.startsWith('--'));

const labelsPath = arg('--labels') || positionals[0] || null;
const knownGoodPath = arg('--known-good');
const knownBadPath = arg('--known-bad');
const outPath = arg('--out')
  || positionals[1]
  || path.join(__dirname, '..', 'calibration-dataset.json');
const listFilter = arg('--list');

if (!labelsPath && !knownGoodPath && !knownBadPath) {
  usage();
  process.exit(1);
}

const labels = loadLabels({ labelsPath, knownGoodPath, knownBadPath });
if (labels.size === 0) {
  console.error('No valid labels loaded.');
  process.exit(1);
}

const db = new Database(config.dbPath, { readonly: true });

const labelledEmails = [...labels.keys()];
const placeholders = labelledEmails.map(() => '?').join(',');
const sql = `
  SELECT * FROM contacts
  WHERE verified_at IS NOT NULL
    AND lower(email) IN (${placeholders})
    ${listFilter ? 'AND list_id = ?' : ''}
`;
const params = listFilter ? [...labelledEmails, listFilter] : labelledEmails;
const rows = db.prepare(sql).all(...params);
db.close();

// Prefer the most recently verified row when the same email appears in multiple lists.
const evidenceByEmail = new Map();
for (const row of rows) {
  const email = normalizeEmail(row.email);
  const prev = evidenceByEmail.get(email);
  if (!prev || String(row.verified_at) > String(prev.verified_at)) {
    evidenceByEmail.set(email, row);
  }
}

const items = [];
let missingEvidence = 0;
const sources = {};
const truthCounts = { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
let agreeWithEngine = 0;
let disagreeWithEngine = 0;

for (const [email, label] of labels) {
  const row = evidenceByEmail.get(email);
  if (!row) {
    missingEvidence++;
    continue;
  }
  const result = contactToResult(row);
  const engineVerdict = String(result.deliverability || '').toLowerCase();
  if (engineVerdict === label.groundTruth) agreeWithEngine++;
  else if (engineVerdict && engineVerdict !== 'unknown' && label.groundTruth !== 'unknown') {
    disagreeWithEngine++;
  }

  sources[label.groundTruthSource] = (sources[label.groundTruthSource] || 0) + 1;
  truthCounts[label.groundTruth] = (truthCounts[label.groundTruth] || 0) + 1;

  items.push({
    result,
    groundTruth: label.groundTruth,
    groundTruthSource: label.groundTruthSource,
    referenceVerdict: label.referenceVerdict,
    previousVerdict: label.previousVerdict,
    email,
    timestamp: row.verified_at,
  });
}

fs.writeFileSync(outPath, JSON.stringify(items, null, 2));

console.log(`\nExported ${items.length} labelled record(s) to: ${outPath}`);
console.log(`  labels supplied:     ${labels.size}`);
console.log(`  missing evidence:    ${missingEvidence} (labelled but not verified in DB)`);
console.log(`  ground-truth sources:${JSON.stringify(sources)}`);
console.log(`  label mix:           ${JSON.stringify(truthCounts)}`);
console.log(`  engine agrees / disagrees with GT (excl. unknown): ${agreeWithEngine} / ${disagreeWithEngine}`);

if (items.length === 0) {
  console.warn('\n⚠ No rows exported. Verify the labelled addresses (live SMTP) so evidence exists, then re-run.');
} else if (disagreeWithEngine === 0 && agreeWithEngine > 0) {
  console.warn('\n⚠ Every exported row has engine verdict === groundTruth.');
  console.warn('  That can be legitimate for clean seed lists, but the calibrator needs some');
  console.warn('  disagreements (e.g. catch-all/risky engine vs deliverable GT) to learn reliability.');
}
if (items.length > 0 && items.length < 20) {
  console.warn(`\n⚠ Only ${items.length} records. Training needs >= 20 scorable samples.`);
} else if (items.length >= 20) {
  console.log('\nNext: node scripts/train-calibration.mjs ' + path.basename(outPath) + '   (review, then add --deploy)');
}
