// Generic Loading / Empty / Error state primitives.
//
// These standardize the three states that are currently expressed ad-hoc across
// views (`<p className="muted">Loading…</p>`, `.empty` divs, `.error` text).
// Presentation only — no domain or API knowledge.
import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function EmptyState({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>{title}</div>
      {children && (
        <div className="muted" style={{ marginTop: 6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Error state that can communicate WHAT happened and WHAT to do next.
export function ErrorState({
  message,
  hint,
}: {
  message: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <p className="error">{message}</p>
      {hint && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
