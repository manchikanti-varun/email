// Minimal Tooltip primitive. Uses the native `title` attribute on a wrapping
// span for a dependency-free, accessible hover/focus hint. This matches how the
// current app already conveys hints (title attributes) and adds no new deps.
import type { ReactNode } from 'react';

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span title={text} style={{ cursor: 'help' }}>
      {children}
    </span>
  );
}
