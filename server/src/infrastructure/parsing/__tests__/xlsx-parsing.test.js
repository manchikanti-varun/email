// PHASE 2C — Real XLSX/XLS binary parsing coverage for parseUpload().
// Fixtures are generated deterministically in-memory with the same `xlsx`
// library the parser uses (already a project dependency), so no large binary
// files are committed. Verifies extraction, normalization, dedupe, blank rows,
// malformed data, and the XLS (BIFF8) code path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { parseUpload } from '../file-parser.js';

// Build an .xlsx (or .xls) buffer from an array-of-arrays sheet.
function buildWorkbook(rows, bookType = 'xlsx') {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType });
}

test('XLSX: extracts emails from a named Email column', () => {
  const buf = buildWorkbook([
    ['Name', 'Email', 'Company'],
    ['Ada', 'ada@example.com', 'Acme'],
    ['Bob', 'bob@example.com', 'Beta'],
  ]);
  const r = parseUpload(buf, 'contacts.xlsx');
  assert.deepEqual(r.emails.sort(), ['ada@example.com', 'bob@example.com']);
  assert.match(String(r.columnHint), /email/i);
});

test('XLSX: deduplicates and normalizes (case/whitespace)', () => {
  const buf = buildWorkbook([
    ['Email'],
    ['User@Example.com'],
    ['  user@example.com  '],
    ['other@example.com'],
  ]);
  const r = parseUpload(buf, 'dupes.xlsx');
  assert.deepEqual(r.emails.sort(), ['other@example.com', 'user@example.com']);
  assert.equal(r.duplicates, 1, 'case/space variant is a duplicate after normalization');
});

test('XLSX: blank rows are ignored', () => {
  const buf = buildWorkbook([
    ['Email'],
    ['a@example.com'],
    ['', ''],
    [null],
    ['b@example.com'],
  ]);
  const r = parseUpload(buf, 'blanks.xlsx');
  assert.deepEqual(r.emails.sort(), ['a@example.com', 'b@example.com']);
});

test('XLSX: malformed / non-email cells are skipped, valid ones kept', () => {
  const buf = buildWorkbook([
    ['Email'],
    ['not-an-email'],
    ['also bad @ nope'],
    ['good@example.com'],
    ['12345'],
  ]);
  const r = parseUpload(buf, 'malformed.xlsx');
  assert.deepEqual(r.emails, ['good@example.com'], 'only the valid address is extracted');
});

test('XLSX: no email column / no emails -> empty result (no throw)', () => {
  const buf = buildWorkbook([
    ['Name', 'City'],
    ['Ada', 'London'],
    ['Bob', 'Paris'],
  ]);
  const r = parseUpload(buf, 'nomails.xlsx');
  assert.equal(r.emails.length, 0);
});

test('XLSX: finds emails even without a header (column scoring)', () => {
  const buf = buildWorkbook([
    ['Ada Lovelace', 'ada@example.com', 'UK'],
    ['Bob Builder', 'bob@example.com', 'US'],
  ]);
  const r = parseUpload(buf, 'noheader.xlsx');
  assert.deepEqual(r.emails.sort(), ['ada@example.com', 'bob@example.com']);
});

// ---- XLS (legacy BIFF8) — the parser routes .xls through the same xlsx.read.
test('XLS (legacy .xls): parser accepts the .xls extension and extracts emails', () => {
  // SheetJS can WRITE and READ the legacy BIFF8 format; this proves the .xls
  // branch of parseUpload works with a real binary of that type.
  const buf = buildWorkbook([
    ['Email'],
    ['legacy@example.com'],
    ['legacy2@example.com'],
  ], 'biff8');
  const r = parseUpload(buf, 'legacy.xls');
  assert.deepEqual(r.emails.sort(), ['legacy2@example.com', 'legacy@example.com']);
});
