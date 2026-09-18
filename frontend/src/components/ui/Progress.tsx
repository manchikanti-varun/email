// Generic determinate progress bar (wraps existing `.progress-outer` /
// `.progress-inner` classes). Presentation only — the caller computes percent
// from REAL data; this component never fabricates progress.
export function Progress({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="progress-outer">
      <div className="progress-inner" style={{ width: pct + '%' }} />
    </div>
  );
}
