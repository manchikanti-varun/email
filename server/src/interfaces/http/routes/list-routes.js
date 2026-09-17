import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { asyncHandler } from '../middleware.js';

export function makeListRouter({
  uploadList, startListVerification, getListProgress, getLists, getListDetail,
  getCleaningPlan, getExportData, bulkDeleteByClassification, scheduleReverification,
  deleteList, authRequired, uploadLimitMb,
}) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadLimitMb * 1024 * 1024, files: 1 },
  });

  // Upload: parse, dedupe, create list (does not verify yet).
  // With ?progress=1 (or Accept: application/x-ndjson), streams stage events:
  //   {"stage":"parsing"}\n
  //   {"stage":"saving","total":N}\n
  //   {"stage":"done", ...UploadResult}\n
  // Default remains a single JSON body for API compatibility.
  router.post('/upload', authRequired, upload.single('file'), asyncHandler((req, res) => {
    const wantProgress = req.query.progress === '1'
      || (req.headers.accept || '').includes('application/x-ndjson');

    if (!wantProgress) {
      const result = uploadList.execute(req.user.id, req.file?.buffer, req.file?.originalname);
      return res.json(result);
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    // Disable proxy buffering when present (nginx).
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const write = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
      if (typeof res.flush === 'function') res.flush();
    };

    try {
      const result = uploadList.execute(
        req.user.id,
        req.file?.buffer,
        req.file?.originalname,
        {
          onProgress: (evt) => {
            if (evt.stage === 'done') return; // final payload written below
            write(evt);
          },
        },
      );
      write({ stage: 'done', ...result });
      res.end();
    } catch (e) {
      // If headers already sent, emit an error event on the stream.
      if (res.headersSent) {
        write({
          stage: 'error',
          error: e.message || 'Upload failed',
          status: e.status || 500,
        });
        return res.end();
      }
      throw e;
    }
  }));

  // Trigger verification of a list.
  router.post('/:id/verify', authRequired, asyncHandler((req, res) => {
    const reverify = req.query.reverify === 'true';
    res.json(startListVerification.execute(req.user.id, req.params.id, reverify));
  }));

  // Progress polling.
  router.get('/:id/progress', authRequired, asyncHandler((req, res) => {
    res.json(getListProgress.execute(req.user.id, req.params.id));
  }));

  // Schedule re-verification.
  router.post('/:id/schedule', authRequired, asyncHandler((req, res) => {
    res.json(scheduleReverification.execute(
      req.user.id, req.params.id, req.body?.intervalDays, req.body?.enabled));
  }));

  // List index.
  router.get('/', authRequired, asyncHandler((req, res) => {
    res.json(getLists.execute(req.user.id));
  }));

  // List detail.
  router.get('/:id', authRequired, asyncHandler((req, res) => {
    res.json(getListDetail.execute(req.user.id, req.params.id));
  }));

  // Automated cleaning plan.
  router.get('/:id/clean', authRequired, asyncHandler((req, res) => {
    res.json(getCleaningPlan.execute(req.user.id, req.params.id));
  }));

  // Export (CSV or XLSX). Formatting is an HTTP concern and lives here.
  router.get('/:id/export', authRequired, asyncHandler((req, res) => {
    const filter = (req.query.filter || 'all').toString();
    const format = (req.query.format || 'csv').toString();
    const { list, contacts } = getExportData.execute(req.user.id, req.params.id, filter);
    // Sanitize filename: strip control chars and CRLF to prevent header injection,
    // then replace non-safe chars with underscores.
    const safeName = (list.name || 'list')
      .replace(/[\r\n\x00-\x1f]/g, '')
      .replace(/[^a-z0-9._-]/gi, '_')
      .slice(0, 100);

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
  }));

  // Bulk contact actions.
  router.post('/:id/contacts/bulk', authRequired, asyncHandler((req, res) => {
    const { action, classification } = req.body || {};
    res.json(bulkDeleteByClassification.execute(req.user.id, req.params.id, action, classification));
  }));

  // Delete list.
  router.delete('/:id', authRequired, asyncHandler((req, res) => {
    res.json(deleteList.execute(req.user.id, req.params.id));
  }));

  return router;
}
