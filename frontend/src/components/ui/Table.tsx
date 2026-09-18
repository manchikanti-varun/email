// Generic Table primitives (thin wrappers around native table elements).
// Presentation only — column definitions and row rendering stay with features.
import type { ReactNode, TableHTMLAttributes } from 'react';

export function Table({
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return <table {...rest}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  onClick,
  clickable = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  clickable?: boolean;
}) {
  return (
    <tr onClick={onClick} style={clickable ? { cursor: 'pointer' } : undefined}>
      {children}
    </tr>
  );
}
