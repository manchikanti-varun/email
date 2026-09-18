// Generic loading skeletons (presentation only).
// Moved verbatim from components/ui.tsx (Phase 1A split).

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        {Array.from({ length: n }, (_, i) => (
          <div className="card" key={i}>
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" style={{ width: '60%', height: 26 }} />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-card" />
    </>
  );
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="card" key={i} style={{ marginBottom: 12 }}>
          <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          <div className="skeleton skeleton-line short" style={{ marginBottom: 0 }} />
        </div>
      ))}
    </>
  );
}
