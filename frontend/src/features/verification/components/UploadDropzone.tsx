// Accessible file dropzone: click-to-browse + drag/drop. Presentation only —
// it hands the selected File to the caller. Extracted from DashboardView.
import { useRef, useState } from 'react';

const ACCEPT = '.csv,.xlsx,.xls,.txt';

export function UploadDropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      className={`dropzone ${dragging ? 'drag' : ''}`.trim()}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      aria-label="Upload a CSV, XLSX, or TXT file of email addresses"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
    >
      <p><strong>Drop a CSV, XLSX, or TXT file here</strong> or click to browse</p>
      <p className="muted">The email column is detected automatically. Duplicates are removed.</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        disabled={disabled}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </div>
  );
}
