// Parses uploaded files (CSV / XLSX / TXT) into a deduplicated set of email
// addresses, auto-detecting the email column. Infrastructure concern (uses the
// xlsx library); relies on the domain's normalizeEmail for normalization.
//
// Performance notes:
// - Column detection samples the first SAMPLE_ROWS only (not the whole file).
// - CSV with an "email" header takes a fast single-pass extract path.
// - XLSX is read with lean SheetJS options (no styles/formulas/VBA).
import xlsx from 'xlsx';
import { normalizeEmail } from '../../domain/verification/syntax.js';

const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** Rows sampled when guessing the email column (full-file scoring is too slow). */
const SAMPLE_ROWS = 200;

function findEmailHeaderIndex(firstRow) {
  return firstRow.findIndex((c) => /e-?mail/i.test(c));
}

function scoreEmailColumn(rows, startRow, sampleLimit) {
  const end = Math.min(rows.length, startRow + sampleLimit);
  let width = 0;
  for (let r = startRow; r < end; r++) {
    if (rows[r].length > width) width = rows[r].length;
  }
  const scores = new Array(width).fill(0);
  for (let r = startRow; r < end; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (EMAIL_LIKE.test(String(row[c] ?? ''))) scores[c]++;
    }
  }
  let bestCol = 0;
  let best = -1;
  for (let c = 0; c < width; c++) {
    if (scores[c] > best) { best = scores[c]; bestCol = c; }
  }
  return bestCol;
}

function extractEmailsFromColumn(rows, startRow, col) {
  const emails = [];
  for (let r = startRow; r < rows.length; r++) {
    const cell = String(rows[r][col] ?? '');
    const match = cell.match(EMAIL_LIKE);
    if (match) emails.push(match[0]);
  }
  return emails;
}

function extractEmailsFullScan(rows) {
  const emails = [];
  for (const row of rows) {
    for (const cell of row) {
      const m = String(cell ?? '').match(EMAIL_LIKE);
      if (m) emails.push(m[0]);
    }
  }
  return emails;
}

function extractFromRows(rows) {
  if (!rows.length) return { emails: [], columnHint: null };

  const firstRow = rows[0].map((c) => String(c ?? '').trim());
  const emailHeaderIdx = findEmailHeaderIndex(firstRow);
  const headerHasEmailWord = emailHeaderIdx !== -1;
  const startRow = headerHasEmailWord ? 1 : 0;
  const bestCol = headerHasEmailWord
    ? emailHeaderIdx
    : scoreEmailColumn(rows, startRow, SAMPLE_ROWS);

  let emails = extractEmailsFromColumn(rows, startRow, bestCol);

  // Only fall back to a full scan when the chosen column produced nothing.
  if (emails.length === 0) {
    emails = extractEmailsFullScan(rows);
  }

  return {
    emails,
    columnHint: headerHasEmailWord ? firstRow[bestCol] : `column ${bestCol + 1}`,
  };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.trim() === '') continue;
    // Fast path: if the line has no quotes, a simple split is correct and
    // avoids the O(n) character scan. Most CSV exports are unquoted.
    if (!line.includes('"')) {
      rows.push(line.split(','));
      continue;
    }
    // Slow path: handle quoted fields (commas and escaped quotes inside).
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

/**
 * Fast CSV path when the first row names an email column: extract + dedupe in
 * one pass without building a full in-memory score matrix.
 */
function parseCsvFastEmailColumn(text) {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let headerCells = null;
  let startLi = 0;

  for (let li = 0; li < lines.length; li++) {
    if (lines[li].trim() === '') continue;
    const headerLine = lines[li];
    headerCells = headerLine.includes('"')
      ? parseCsv(headerLine)[0]
      : headerLine.split(',');
    headerCells = headerCells.map((c) => String(c ?? '').trim());
    headerIdx = findEmailHeaderIndex(headerCells);
    startLi = li + 1;
    break;
  }
  if (headerIdx === -1 || !headerCells) return null;

  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  let rawCount = 0;

  for (let li = startLi; li < lines.length; li++) {
    const line = lines[li];
    if (!line || line.trim() === '') continue;
    let cells;
    if (!line.includes('"')) cells = line.split(',');
    else {
      // Rare quoted row — reuse the full CSV cell parser for this line only.
      cells = parseCsv(line)[0] || [];
    }
    const cell = String(cells[headerIdx] ?? '');
    const match = cell.match(EMAIL_LIKE);
    if (!match) continue;
    rawCount += 1;
    const norm = normalizeEmail(match[0]);
    if (!norm) continue;
    if (seen.has(norm)) { duplicates += 1; continue; }
    seen.add(norm);
    unique.push(norm);
  }

  return {
    emails: unique,
    duplicates,
    columnHint: headerCells[headerIdx],
    rawCount,
  };
}

function dedupeEmails(emails) {
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
  return { emails: unique, duplicates, rawCount: emails.length };
}

export function parseUpload(buffer, filename) {
  const lower = (filename || '').toLowerCase();

  // CSV with a named email column: single-pass extract + dedupe (fastest path).
  if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf8');
    const fast = parseCsvFastEmailColumn(text);
    if (fast) return fast;

    const rows = parseCsv(text);
    const { emails, columnHint } = extractFromRows(rows);
    const deduped = dedupeEmails(emails);
    return { ...deduped, columnHint };
  }

  let rows = [];
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    // Lean SheetJS read — skip styles/VBA/deps; biggest XLSX speed win.
    const wb = xlsx.read(buffer, {
      type: 'buffer',
      cellDates: false,
      cellNF: false,
      cellStyles: false,
      bookDeps: false,
      bookFiles: false,
      bookVBA: false,
      sheetStubs: false,
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  } else {
    // TXT / unknown: one address per line.
    rows = buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => [l.trim()]);
  }

  const { emails, columnHint } = extractFromRows(rows);
  const deduped = dedupeEmails(emails);
  return { ...deduped, columnHint };
}
