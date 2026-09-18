// The bulk verification workflow: upload a file → see the parsed summary →
// start verification (which navigates to the list detail, where progress
// polling takes over). Single implementation, embedded both on the Dashboard
// and on the dedicated #/bulk page.
//
// Owns no data logic itself — it uses useBulkVerification. There is no separate
// progress step here because, in this product, bulk progress is tracked on the
// list-detail page after navigation (not fabricated on this screen).
import { useBulkVerification } from '../hooks/useBulkVerification';
import { UploadDropzone } from './UploadDropzone';
import { BulkUploadResult } from './BulkUploadResult';

export function BulkVerificationPanel({ heading = 'Upload a new list' }: { heading?: string }) {
  const { upload, message, error, busy, uploadFile, startVerification } = useBulkVerification();

  return (
    <div className="card">
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>{heading}</h3>
      </div>

      <UploadDropzone onFile={uploadFile} disabled={busy} />

      <div style={{ marginTop: 14 }}>
        {message && <p className="muted" aria-live="polite">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {upload && <BulkUploadResult upload={upload} onStart={startVerification} />}
      </div>
    </div>
  );
}
