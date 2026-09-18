// A single contact row + the small cells it needs (risk summary, AI-confidence).
// Extracted from ListDetailView. Presentation only; row click opens detail.
import type { Contact, RiskSignal } from '../../../types';
import {
  ActionBadge,
  DeliverabilityLabel,
  ConfidenceLabel,
  CalibratedBadge,
} from '../../../components/domain';
import { deterministicConfidence } from '../../../lib/format';
import { calFromContact, hasRealMl } from '../types';

function RiskSummary({ riskSignals }: { riskSignals?: RiskSignal[] }) {
  if (!riskSignals || !riskSignals.length) return <span className="muted">—</span>;
  const first = riskSignals[0].label;
  const extra = riskSignals.length > 1 ? ` +${riskSignals.length - 1}` : '';
  return (
    <span className="pill" title={riskSignals.map((r) => r.label).join(', ')}>
      {first}
      {extra}
    </span>
  );
}

// AI-confidence cell: trained-ML calibrated badge when a model exists; otherwise
// the engine's own rule-based confidence as a percentage, honestly tagged.
function AiConfidenceCell({ contact }: { contact: Contact }) {
  if (hasRealMl(contact)) return <CalibratedBadge cal={calFromContact(contact)} />;
  const det = deterministicConfidence(contact.confidence);
  if (!det) return <span className="muted">—</span>;
  return (
    <span
      className="pill"
      style={{ color: 'var(--text-2)' }}
      title="The engine's own confidence in this verdict (rule-based). No ML model is deployed, so this is not an independent ML estimate."
    >
      {det.level} {det.pct}% <span style={{ fontSize: 9, opacity: 0.7 }}>rule-based</span>
    </span>
  );
}

export function ContactRow({ contact, onOpen }: { contact: Contact; onOpen: (c: Contact) => void }) {
  return (
    <tr
      style={{ cursor: 'pointer' }}
      tabIndex={0}
      onClick={() => onOpen(contact)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(contact);
        }
      }}
    >
      <td className="email-cell" data-label="Email">{contact.email}</td>
      <td data-label="Verdict">
        <DeliverabilityLabel value={contact.deliverability || contact.status} />
        <span className="muted" style={{ fontSize: 11 }}> · {contact.deliverabilityScore ?? contact.score ?? '—'}</span>
      </td>
      <td data-label="Confidence">
        <ConfidenceLabel value={contact.confidence} />
      </td>
      <td data-label="Confidence %">
        <AiConfidenceCell contact={contact} />
      </td>
      <td data-label="Risk signals">
        <RiskSummary riskSignals={contact.riskSignals} />
      </td>
      <td data-label="Action">
        <ActionBadge action={contact.recommendedAction || contact.classification} />
      </td>
    </tr>
  );
}
