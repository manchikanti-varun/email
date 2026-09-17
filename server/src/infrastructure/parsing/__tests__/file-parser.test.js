import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpload } from '../file-parser.js';

test('CSV with email header: extracts and dedupes in fast path', () => {
  const csv = [
    'Name,Email,Company',
    'Ada,ada@example.com,Acme',
    'Bob,bob@example.com,Beta',
    'Ada2,ada@example.com,Acme', // duplicate
    'NoMail,,Gamma',
  ].join('\n');
  const r = parseUpload(Buffer.from(csv), 'contacts.csv');
  assert.equal(r.total ?? r.emails.length, 2);
  assert.deepEqual(r.emails, ['ada@example.com', 'bob@example.com']);
  assert.equal(r.duplicates, 1);
  assert.match(String(r.columnHint), /email/i);
});

test('CSV without email header: samples columns and still finds emails', () => {
  const csv = [
    'Ada Lovelace,ada@example.com,UK',
    'Bob Builder,bob@example.com,US',
    'Carol,carol@example.org,DE',
  ].join('\n');
  const r = parseUpload(Buffer.from(csv), 'sheet.csv');
  assert.equal(r.emails.length, 3);
  assert.ok(r.emails.includes('ada@example.com'));
});

test('TXT: one address per line', () => {
  const txt = 'a@example.com\nb@example.com\na@example.com\n';
  const r = parseUpload(Buffer.from(txt), 'list.txt');
  assert.deepEqual(r.emails, ['a@example.com', 'b@example.com']);
  assert.equal(r.duplicates, 1);
});

test('empty file -> no emails', () => {
  const r = parseUpload(Buffer.from(''), 'empty.csv');
  assert.equal(r.emails.length, 0);
});
