import type { ReactNode, CSSProperties } from 'react';

// Backdrop modal. Clicking the backdrop (but not the card) closes it,
// mirroring the old vanilla behavior.
export function Modal({
  onClose,
  children,
  cardStyle,
  cardClassName = '',
}: {
  onClose: () => void;
  children: ReactNode;
  cardStyle?: CSSProperties;
  cardClassName?: string;
}) {
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-card ${cardClassName}`} style={cardStyle}>
        {children}
      </div>
    </div>
  );
}
