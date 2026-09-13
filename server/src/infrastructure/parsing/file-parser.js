// Parses uploaded files (CSV / XLSX / TXT) into a deduplicated set of email
// addresses, auto-detecting the email column. Infrastructure concern (uses the
// xlsx library); relies on the domain's normalizeEmail for normalization.
import xlsx from 'xlsx';
import { normalizeEmail } from '../../domain/verification/syntax.js';

const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function extractFromRows(rows) {
  if (!rows.length) return { emails: [], columnHint: null };

  const firstRow = rows[0].map((c) => String(c ?? '').trim());
  const headerHasEmailWord = firstRow.some((c) => /e-?mail/i.test(c));

  const width = Math.max(...rows.map((r) => r.length));
  const scores = new Array(width).fill(0);
  const startRow = headerHasEmailWord ? 1 : 0;
  for (let r = startRow; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (EMAIL_LIKE.test(String(rows[r][c] ?? ''))) scores[c]++;
    }
  }
  let bestCol = 0;
  let best = -1;
  for (let c = 0; c < width; c++) {
    if (scores[c] > best) { best = scores[c]; bestCol = c; }
  }

  const emails = [];
  for (let r = startRow; r < rows.length; r++) {
    const cell = String(rows[r][bestCol] ?? '');
    const match = cell.match(EMAIL_LIKE);
    if (match) emails.push(match[0]);
  }

  if (emails.length === 0) {
    for (const row of rows) {
      for (const cell of row) {
        const m = String(cell ?? '').match(EMAIL_LIKE);
        if (m) emails.push(m[0]);
      }
    }
  }

  return {
    emails,
    columnHint: headerHasEmailWord ? firstRow[bestCol] : `column ${bestCol + 1}`,
  };
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

export function parseUpload(buffer, filename) {
  const lower = (filename || '').toLowerCase();
  let rows = [];

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const wb = xlsx.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  } else if (lower.endsWith('.csv')) {
    rows = parseCsv(buffer.toString('utf8'));
  } else {
    rows = buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => [l.trim()]);
  }

  const { emails, columnHint } = extractFromRows(rows);

  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const e of emails) {
    const norm = normalizeEmail(e);
    if (!norm) continue;
    if (seen.has(norm)) { duplicates++; continue; }
    seen.add(norm);
    unique.push(norm);
  }

  return { emails: unique, duplicates, columnHint, rawCount: emails.length };
}
