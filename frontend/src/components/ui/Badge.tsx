// Generic Badge / Pill primitives (presentation only, no domain knowledge).
// The domain-specific verdict/action badges live in components/domain.
import type { CSSProperties, ReactNode } from 'react';

// Neutral pill chip (wraps the existing `.pill` class).
export function Pill({
  children,
  title,
  style,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span className={`pill ${className}`.trim()} title={title} style={style}>
      {children}
    </span>
  );
}

// Colored status badge with a leading dot. `tone` sets the color via inline
// style so callers can pass any semantic color token.
export function StatusBadge({
  label,
  color = 'var(--muted)',
}: {
  label: ReactNode;
  color?: string;
}) {
  return (
    <span className="badge" style={{ background: `${color}22`, color }}>
      {label}
    </span>
  );
}
