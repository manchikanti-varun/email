// Backdrop modal primitive. Clicking the backdrop (but not the card) closes it.
// Behavior preserved verbatim from the original components/Modal.tsx.
import type { ReactNode, CSSProperties } from 'react';

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
