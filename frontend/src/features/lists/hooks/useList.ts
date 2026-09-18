// Loads a list's detail and, while it is verifying, polls progress until done.
//
// Polling semantics are preserved verbatim from the original ListDetailView:
//   - if the list status is 'verifying' or 'pending', start polling
//   - poll GET /lists/:id/progress every 800ms
//   - on status 'done': stop polling, refresh credits, reload the detail
//   - transient poll errors are ignored
//   - the interval is cleared on unmount / id change
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListDetail, Progress } from '../../../types';
import { listsApi } from '../services/lists-api';

const POLL_INTERVAL_MS = 800;

export function useList(id: string, onCreditsChanged?: () => void) {
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const p = await listsApi.progress(id);
        setProgress(p);
        if (p.status === 'done') {
          stopPolling();
          onCreditsChanged?.();
          const d = await listsApi.detail(id);
          setVerifying(false);
          setDetail(d);
        }
      } catch {
        /* ignore transient errors */
      }
    }, POLL_INTERVAL_MS);
  }, [id, onCreditsChanged, stopPolling]);

  const load = useCallback(async () => {
    const d = await listsApi.detail(id);
    if (d.list.status === 'verifying' || d.list.status === 'pending') {
      setVerifying(true);
      setDetail(d);
      startPolling();
    } else {
      setVerifying(false);
      setDetail(d);
    }
  }, [id, startPolling]);

  // Begin a fresh verification/re-verification cycle (used after reverify).
  const beginVerifying = useCallback(() => {
    setProgress(null);
    setVerifying(true);
    startPolling();
  }, [startPolling]);

  // Re-run only when the list id changes. load()/stopPolling are stable enough
  // for this lifecycle; load() sets state only after awaited fetches, so the
  // set-state-in-effect guard is a false positive (mirrors the original view).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => {});
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { detail, progress, verifying, reload: load, beginVerifying };
}
