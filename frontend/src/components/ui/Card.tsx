// Generic Card + StatCard + PageHeader primitives, built on existing classes
// (`.card`, `.stat`, `.stat-label`, `.page-title`, `.page-sub`).
import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  if (actions) {
    return (
      <div className="toolbar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            {title}
          </h1>
          {subtitle && (
            <p className="page-sub" style={{ margin: 0 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="spacer" />
        {actions}
      </div>
    );
  }
  return (
    <>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-sub">{subtitle}</p>}
    </>
  );
}
