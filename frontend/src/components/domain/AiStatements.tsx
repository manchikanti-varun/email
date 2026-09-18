// Domain widget: AI statement vocabulary tags (FACT / INFERENCE / PREDICTION /
// RECOMMENDATION) and their confidence markers. These render the structured
// statement types the AI intelligence layer returns. Moved verbatim from
// components/ui.tsx (Phase 1A domain/primitive split).
import type { Statement, StatementKind, StatementConfidence } from '../../types';

export function KindTag({ kind }: { kind: StatementKind }) {
  const cls =
    ({ FACT: 'safe', INFERENCE: 'brand', PREDICTION: 'review', RECOMMENDATION: 'brand-2' } as Record<string, string>)[kind] || 'muted';
  return <span className="pill" style={{ background: `var(--${cls})`, color: '#0b0f17', fontSize: 10 }}>{kind}</span>;
}

export function ConfTag({ c }: { c?: StatementConfidence }) {
  if (!c) return null;
  const color = ({ HIGH: 'var(--safe)', MEDIUM: 'var(--review)', LOW: 'var(--muted)' } as Record<string, string>)[c] || 'var(--muted)';
  return <span className="muted" style={{ fontSize: 11, color }}> · {c}</span>;
}

export function StmtList({ items }: { items?: Statement[] }) {
  if (!items || !items.length) return null;
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 2, listStyle: 'none' }}>
      {items.map((s, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          <KindTag kind={s.kind} />
          <ConfTag c={s.confidence} />
          <br />
          {s.text}
        </li>
      ))}
    </ul>
  );
}
