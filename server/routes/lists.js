import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { config } from '../config.js';
import { authRequired, chargeCredits, publicUser } from '../auth.js';
import { parseUpload } from '../parse.js';
import { summarize } from '../verify/health.js';
import { enqueueVerify } from '../queue.js';
import { upsertSchedule } from '../scheduler.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadLimitMb * 1024 * 1024, files: 1 },
});

function loadContacts(listId) {
  const rows = db.prepare('SELECT * FROM contacts WHERE list_id = ?').all(listId);
  return rows.map((r) => ({
    ...r,
    greylisted: !!r.greylisted,
    signals: safeParse(r.signals),
    reasons: safeParse(r.reasons),
    riskSignals: safeParse(r.risk_signals),
    recommendedAction: r.recommended_action,
  }));
}
function safeParse(v) { try { return JSON.parse(v || '[]'); } catch { return []; } }

// --- Upload: parse, dedupe, create list (does not verify yet) --------------
router.post('/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { emails, duplicates, columnHint, rawCount } = parseUpload(
    req.file.buffer,
    req.file.originalname
  );
  if (emails.length === 0) {
    return res.status(400).json({ error: 'No email addresses found in the file' });
  }

  const listId = nanoid();
  db.prepare(
    `INSERT INTO lists (id, user_id, name, source, total, duplicates, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(listId, req.user.id, req.file.originalname, columnHint, emails.length, duplicates);

  const insert = db.prepare(
    'INSERT INTO contacts (id, list_id, email) VALUES (?, ?, ?)'
  );
  const tx = db.transaction((items) => {
    for (const e of items) insert.run(nanoid(), listId, e);
  });
  tx(emails);

  res.json({
    listId,
    total: emails.length,
    duplicates,
    rawCount,
    columnHint,
  });
});

// --- Trigger verification of a list ----------------------------------------
router.post('/:id/verify', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  if (list.status === 'verifying') return res.status(409).json({ error: 'Already verifying' });

  // Only charge for contacts that still need verifying (supports resume/reverify).
  const reverify = req.query.reverify === 'true';
  const pending = reverify
    ? db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ?').get(list.id).n
    : db.prepare('SELECT COUNT(*) n FROM contacts WHERE list_id = ? AND verified_at IS NULL').get(list.id).n;

  if (pending === 0) return res.status(400).json({ error: 'Nothing to verify' });
  if (!chargeCredits(req.user.id, pending)) {
    return res.status(402).json({ error: 'Insufficient credits', needed: pending });
  }

  if (reverify) {
    db.prepare('UPDATE contacts SET verified_at = NULL WHERE list_id = ?').run(list.id);
  }
  const jobId = enqueueVerify(req.user.id, list.id, reverify ? 'reverify' : 'verify');
  res.json({ started: true, jobId, total: pending });
});

// --- Progress polling (reads job state from DB) -----------------------------
router.get('/:id/progress', authRequired, (req, res) => {
  const list = db.prepare('SELECT status FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const job = db.prepare(
    "SELECT done, total, status FROM jobs WHERE list_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(req.params.id);
  res.json({ status: list.status, done: job?.done ?? 0, total: job?.total ?? 0 });
});

// --- Schedule re-verification -----------------------------------------------
router.post('/:id/schedule', authRequired, (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const intervalDays = Math.max(1, parseInt(req.body?.intervalDays || '7', 10));
  const enabled = req.body?.enabled !== false;
  upsertSchedule(list.id, intervalDays, enabled);
  res.json({ ok: true, intervalDays, enabled });
});

// --- List index -------------------------------------------------------------
router.get('/', authRequired, (req, res) => {
  const lists = db.prepare(
    'SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  const withHealth = lists.map((l) => {
    const latest = db.prepare(
      'SELECT health FROM list_history WHERE list_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(l.id);
    return { ...l, health: latest?.health ?? null };
  });
  res.json({ lists: withHealth });
});

// --- List detail: contacts + summary + history ------------------------------
router.get('/:id', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const contacts = loadContacts(list.id);
  const summary = summarize(contacts);
  const history = db.prepare(
    'SELECT health, metrics, counts, created_at FROM list_history WHERE list_id = ? ORDER BY created_at ASC'
  ).all(list.id).map((h) => ({
    ...h,
    metrics: safeParse(h.metrics),
    counts: safeParse(h.counts),
  }));

  // Compute health delta vs previous snapshot.
  let delta = null;
  if (history.length >= 2) {
    delta = Math.round((history[history.length - 1].health - history[history.length - 2].health) * 10) / 10;
  }

  res.json({ list, summary, contacts, history, delta });
});

// --- Automated cleaning plan ------------------------------------------------
router.get('/:id/clean', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const contacts = loadContacts(list.id);
  const plan = { keep: [], review: [], remove: [] };
  for (const c of contacts) {
    if (c.classification === 'safe') plan.keep.push(c.email);
    else if (c.classification === 'remove') plan.remove.push(c.email);
    else plan.review.push(c.email); // review + unknown
  }
  res.json({
    keep: plan.keep.length,
    review: plan.review.length,
    remove: plan.remove.length,
    campaignReady: plan.keep.length,
    plan,
  });
});

// --- Export (CSV or XLSX) ---------------------------------------------------
// filter: all | safe | review | remove | unknown | campaign(=safe)
// format: csv (default) | xlsx
router.get('/:id/export', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const filter = (req.query.filter || 'all').toString();
  const format = (req.query.format || 'csv').toString();
  let contacts = loadContacts(list.id);
  if (filter === 'campaign') contacts = contacts.filter((c) => c.classification === 'safe');
  else if (['safe', 'review', 'remove', 'unknown'].includes(filter)) {
    contacts = contacts.filter((c) => c.classification === filter);
  }

  const safeName = (list.name || 'list').replace(/[^a-z0-9._-]/gi, '_');

  if (format === 'xlsx') {
    const rows = contacts.map((c) => ({
      email: c.email,
      score: c.score ?? '',
      classification: c.classification ?? '',
      status: c.status ?? '',
      recommendation: c.recommendation ?? '',
      reasons: (c.reasons || []).join(' | '),
    }));
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Contacts');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${filter}.xlsx"`);
    return res.send(buf);
  }

  const header = 'email,score,classification,status,recommendation,reasons\n';
  const rows = contacts.map((c) => {
    const reasons = (c.reasons || []).join(' | ').replace(/"/g, '""');
    const rec = (c.recommendation || '').replace(/"/g, '""');
    return `${c.email},${c.score ?? ''},${c.classification ?? ''},${c.status ?? ''},"${rec}","${reasons}"`;
  });
  const csv = header + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${filter}.csv"`);
  res.send(csv);
});

// --- Bulk contact actions ---------------------------------------------------
// action: remove-classification (deletes all contacts of a given classification)
router.post('/:id/contacts/bulk', authRequired, (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const { action, classification } = req.body || {};
  if (action === 'delete-by-classification' &&
      ['safe', 'review', 'remove', 'unknown'].includes(classification)) {
    const info = db.prepare('DELETE FROM contacts WHERE list_id = ? AND classification = ?')
      .run(list.id, classification);
    db.prepare('UPDATE lists SET total = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?')
      .run(list.id, list.id);
    return res.json({ ok: true, deleted: info.changes });
  }
  res.status(400).json({ error: 'Unsupported action' });
});

// --- Import xlsx for export (loaded lazily) ---------------------------------

// --- Delete list ------------------------------------------------------------
router.delete('/:id', authRequired, (req, res) => {
  const info = db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'List not found' });
  res.json({ ok: true });
});

export default router;
