import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useNavigate } from '../lib/useHashRoute';
import { toast } from '../components/Toaster';
import { SkeletonCards } from '../components/ui';
import { scoreColor } from '../lib/format';
import type { ListSummaryRow, UploadResult } from '../types';

export function DashboardView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListSummaryRow[] | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string>('');
  const [uploadErr, setUploadErr] = useState<string>('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.lists().then(({ lists }) => setLists(lists)).catch(() => setLists([]));
  }, []);

  async function handleFile(file: File) {
    setUploadErr('');
    setUpload(null);
    setUploadMsg(`Uploading ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.uploadList(fd, (evt) => {
        if (evt.stage === 'uploading') setUploadMsg(`Uploading ${file.name}…`);
        else if (evt.stage === 'parsing') setUploadMsg(`Parsing ${file.name}…`);
        else if (evt.stage === 'saving') {
          setUploadMsg(
            evt.total
              ? `Saving ${evt.total.toLocaleString()} contacts…`
              : 'Saving contacts…',
          );
        }
      });
      setUploadMsg('');
      setUpload(r);
    } catch (e) {
      setUploadMsg('');
      setUploadErr(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  async function startVerification(listId: string) {
    try {
      await api.verifyList(listId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start verification');
      return;
    }
    navigate('#/lists/' + listId);
  }

  const verified = (lists || []).filter((l) => l.health != null);
  const avg = verified.length
    ? Math.round((verified.reduce((s, l) => s + (l.health || 0), 0) / verified.length) * 10) / 10
    : 0;
  const totalContacts = (lists || []).reduce((s, l) => s + l.total, 0);

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Upload a list to analyze its deliverability health.</p>

      {lists == null ? (
        <SkeletonCards />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 24 }}>
            <div className="card">
              <div className="stat-label">Lists</div>
              <div className="stat">{lists.length}</div>
            </div>
            <div className="card">
              <div className="stat-label">Contacts</div>
              <div className="stat">{totalContacts.toLocaleString()}</div>
            </div>
            <div className="card">
              <div className="stat-label">Avg. Health</div>
              <div className="stat" style={{ color: scoreColor(avg) }}>{avg || '—'}</div>
            </div>
            <div className="card">
              <div className="stat-label">Credits</div>
              <div className="stat">{user?.credits.toLocaleString()}</div>
            </div>
          </div>

          <div className="card">
            <div className="toolbar">
              <h3 style={{ margin: 0 }}>Upload a new list</h3>
            </div>
            <div
              className={`dropzone ${dragging ? 'drag' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
              }}
            >
              <p><strong>Drop a CSV, XLSX, or TXT file here</strong> or click to browse</p>
              <p className="muted">The email column is detected automatically. Duplicates are removed.</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
            <div style={{ marginTop: 14 }}>
              {uploadMsg && <p className="muted">{uploadMsg}</p>}
              {uploadErr && <p className="error">{uploadErr}</p>}
              {upload && (
                <div className="card" style={{ background: 'var(--panel-2)' }}>
                  <p>
                    Parsed <b>{upload.total.toLocaleString()}</b> unique emails ({upload.duplicates} duplicates removed)
                    from <b>{upload.columnHint || 'file'}</b>.
                  </p>
                  {upload.timings && (
                    <p className="muted" style={{ marginTop: 4 }}>
                      Parse {upload.timings.parseMs} ms · Save {upload.timings.saveMs} ms
                      · Total {upload.timings.totalMs} ms
                    </p>
                  )}
                  <button className="btn" onClick={() => startVerification(upload.listId)}>
                    Verify {upload.total.toLocaleString()} emails ({upload.total} credits)
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
