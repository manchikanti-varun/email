// The final verdict — the strongest visual element on the result screen.
//
// Uses the backend's authoritative `mailboxStatus`
// (DELIVERABLE | UNDELIVERABLE | ACCEPT_ALL | UNKNOWN) as the headline, falling
// back to `deliverability` only when needed. Backend verdict names are NOT
// renamed; we add a human-readable line and a concise explanation drawn from
// the backend's own `reasons`. No verdict is computed here.
import type { VerifyResult } from '../../../types';

type Verdict = 'DELIVERABLE' | 'UNDELIVERABLE' | 'ACCEPT_ALL' | 'UNKNOWN';

const VERDICT_META: Record<Verdict, { title: string; blurb: string; cls: string }> = {
  DELIVERABLE: {
    title: 'Deliverable',
    blurb: 'The mailbox was directly confirmed and can receive mail.',
    cls: 'verdict-deliverable',
  },
  UNDELIVERABLE: {
    title: 'Undeliverable',
    blurb: 'The mail server rejected this recipient. Mail will bounce.',
    cls: 'verdict-undeliverable',
  },
  ACCEPT_ALL: {
    title: 'Accept-all',
    blurb:
      'The recipient server accepted both the target and a randomized probe, ' +
      'indicating the domain may accept mail for arbitrary recipients. SMTP ' +
      'verification therefore cannot conclusively confirm whether this specific ' +
      'mailbox exists. The mail path itself is healthy — this is not a failure.',
    cls: 'verdict-acceptall',
  },
  UNKNOWN: {
    title: 'Unknown',
    blurb:
      'MailHealth could not obtain conclusive SMTP evidence. This may be caused ' +
      'by temporary server behavior, a timeout, a connection failure, or other ' +
      'transport limitations. This is unconfirmed — not the same as undeliverable, ' +
      'and it does not mean the address is invalid.',
    cls: 'verdict-unknown',
  },
};

function verdictOf(result: VerifyResult): Verdict {
  const ms = result.mailboxStatus;
  if (ms === 'DELIVERABLE' || ms === 'UNDELIVERABLE' || ms === 'ACCEPT_ALL' || ms === 'UNKNOWN') {
    return ms;
  }
  // Fallback from deliverability if mailboxStatus is absent.
  switch (result.deliverability) {
    case 'deliverable':
      return 'DELIVERABLE';
    case 'undeliverable':
      return 'UNDELIVERABLE';
    case 'accepted':
      return 'ACCEPT_ALL';
    default:
      return 'UNKNOWN';
  }
}

export function VerificationVerdict({ result }: { result: VerifyResult }) {
  const verdict = verdictOf(result);
  const meta = VERDICT_META[verdict];
  // Prefer the backend's own first reason for the concise explanation; fall
  // back to the static blurb only when none is provided.
  const explanation = (result.reasons && result.reasons[0]) || meta.blurb;

  return (
    <section className={`verdict ${meta.cls}`} aria-live="polite">
      <div className="verdict-email">{result.email}</div>
      <div className="verdict-headline">
        <span className="verdict-title">{meta.title}</span>
        <span className="verdict-code" aria-hidden="true">
          {verdict}
        </span>
      </div>
      <p className="verdict-blurb">{explanation}</p>
    </section>
  );
}
