// Bulk verification workflow state: upload a file (with NDJSON stage messages),
// hold the parsed result, then start verification and navigate to the list.
//
// Behavior mirrors the original DashboardView handleFile()/startVerification():
//   - upload sets a human message per stage (uploading/parsing/saving)
//   - success stores the UploadResult; failure stores an error message
//   - startVerification() POSTs verify, toasts on failure, else navigates to
//     #/lists/:id (where the list-detail polling takes over)
import { useCallback, useState } from 'react';
import { useNavigate } from '../../../lib/useHashRoute';
import { toast } from '../../../components/ui/Toast';
import type { UploadResult } from '../../../types';
import { bulkVerificationApi } from '../services/bulk-verification-api';

export function useBulkVerification() {
  const navigate = useNavigate();
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    setError('');
    setUpload(null);
    setBusy(true);
    setMessage(`Uploading ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await bulkVerificationApi.upload(fd, (evt) => {
        if (evt.stage === 'uploading') setMessage(`Uploading ${file.name}…`);
        else if (evt.stage === 'parsing') setMessage(`Parsing ${file.name}…`);
        else if (evt.stage === 'saving') {
          setMessage(
            evt.total ? `Saving ${evt.total.toLocaleString()} contacts…` : 'Saving contacts…',
          );
        }
      });
      setMessage('');
      setUpload(r);
    } catch (e) {
      setMessage('');
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const startVerification = useCallback(
    async (listId: string) => {
      try {
        await bulkVerificationApi.startVerification(listId);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not start verification');
        return;
      }
      navigate('#/lists/' + listId);
    },
    [navigate],
  );

  const reset = useCallback(() => {
    setUpload(null);
    setMessage('');
    setError('');
  }, []);

  return { upload, message, error, busy, uploadFile, startVerification, reset };
}
