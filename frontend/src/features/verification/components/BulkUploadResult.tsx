// Parsed-upload summary + the "start verification" call to action. Shows only
// backend-provided values (total, duplicates, columnHint, timings) and the
// credit cost the backend implies (1 credit per email). Extracted from
// DashboardView.
import type { UploadResult } from '../../../types';
import { Button } from '../../../components/ui';

export function BulkUploadResult({
  upload,
  onStart,
}: {
  upload: UploadResult;
  onStart: (listId: string) => void;
}) {
  return (
    <div className="card" style={{ background: 'var(--panel-2)' }}>
      <p>
        Parsed <b>{upload.total.toLocaleString()}</b> unique emails ({upload.duplicates} duplicates removed)
        from <b>{upload.columnHint || 'file'}</b>.
      </p>
      {upload.timings && (
        <p className="muted" style={{ marginTop: 4 }}>
          Parse {upload.timings.parseMs} ms · Save {upload.timings.saveMs} ms · Total {upload.timings.totalMs} ms
        </p>
      )}
      <Button onClick={() => onStart(upload.listId)}>
        Verify {upload.total.toLocaleString()} emails ({upload.total} credits)
      </Button>
    </div>
  );
}
