// Contact detail modal: shows a single contact's verdict, confidence, risk
// signals, evidence and recommendation — the same shape as Single Check —
// reusing the shared verification domain components. Fetches the per-contact
// calibrated confidence on open. Extracted from ListDetailView's ContactModal.
import { useEffect, useState } from 'react';
import type { CalibratedConfidence, Contact } from '../../../types';
import { Modal } from '../../../components/ui';
import {
  ActionBadge,
  DeliverabilityLabel,
  ConfidenceLabel,
  RiskChips,
  SignalRow,
  CalibratedConfidencePanel,
  ConfidencePanel,
} from '../../../components/domain';
import { contactsApi } from '../services/contacts-api';
import { calFromContact } from '../types';

export function ContactDetail({
  contact,
  listId,
  onClose,
}: {
  contact: Contact;
  listId: string;
  onClose: () => void;
}) {
  const [cal, setCal] = useState<CalibratedConfidence | undefined>(calFromContact(contact));

  useEffect(() => {
    if (listId && contact.email) {
      contactsApi
        .aiConfidence(listId, contact.email)
        .then((res) => {
          if (res && res.confidence) setCal(res.confidence);
        })
        .catch(() => {});
    }
  }, [listId, contact.email]);

  return (
    <Modal onClose={onClose} cardStyle={{ maxWidth: 560 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }} className="email-cell">{contact.email}</h3>
        <div className="spacer" />
        <ActionBadge action={contact.recommendedAction || contact.classification} />
      </div>

      <div className="grid cols-2" style={{ margin: '14px 0', gap: 12 }}>
        <div className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
          <div className="stat-label">
            Deterministic verdict <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>RULES</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 2px' }}>
            <DeliverabilityLabel value={contact.deliverability || contact.status} />
            <span className="muted" style={{ fontSize: 11 }}>
              score {contact.deliverabilityScore ?? contact.score ?? '—'}/100
            </span>
          </div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            Evidence confidence: <ConfidenceLabel value={contact.confidence} />
          </div>
          <ActionBadge action={contact.recommendedAction || contact.classification} />
        </div>
        <ConfidencePanel cal={cal} confidence={contact.confidence} />
      </div>

      <div className="stat-label">Risk signals</div>
      <div style={{ margin: '4px 0 12px' }}>
        <RiskChips riskSignals={contact.riskSignals} />
      </div>

      <CalibratedConfidencePanel cal={cal} verdict={contact.deliverability || contact.status} />

      <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>Technical evidence</h3>
      {(contact.signals || []).map((s, i) => (
        <SignalRow key={i} signal={s} />
      ))}
      <div className="reasons">
        <b>Why this classification?</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(contact.reasons || []).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
      <div className="recommendation">
        <b>Recommended action:</b> {contact.recommendation || ''}
      </div>
      <button className="btn ghost block" onClick={onClose} style={{ marginTop: 16 }}>
        Close
      </button>
    </Modal>
  );
}
