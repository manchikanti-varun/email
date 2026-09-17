// Deterministic fixtures for the AI Intelligence Layer tests. These mimic the
// exact shapes produced by the verification engine + repositories, so the pure
// modules are exercised against realistic data without any I/O or LLM.

export function contact(overrides = {}) {
  return {
    email: 'user@example.com',
    deliverability: 'deliverable',
    status: 'deliverable',
    confidence: 'high',
    classification: 'safe',
    recommendedAction: 'keep',
    score: 100,
    verified_at: '2026-09-01T00:00:00.000Z',
    greylisted: false,
    smtpSource: 'local-smtp',
    signals: [{ label: 'Valid syntax', status: 'pass' }, { label: 'MX records found', status: 'pass' }],
    reasons: ['The mailbox was directly confirmed to exist and can receive mail.'],
    riskSignals: [],
    ...overrides,
  };
}

// A mixed list: safe, catch-all (risky), disposable (remove), unknown, role.
export function mixedContacts() {
  return [
    contact({ email: 'a@good.com' }),
    contact({ email: 'b@good.com' }),
    contact({ email: 'c@good.com' }),
    contact({
      email: 'sales@corp.com', deliverability: 'accepted', status: 'accepted', confidence: 'medium',
      classification: 'safe', recommendedAction: 'keep', acceptanceType: 'CATCH_ALL',
      score: 100, smtpSource: 'local-smtp',
      riskSignals: [{ code: 'catch_all', label: 'Catch-all · accepted' }],
      signals: [{ status: 'info', label: 'Catch-all domain (mail path healthy)' }],
    }),
    contact({
      email: 'x@mailinator.com', deliverability: 'undeliverable', status: 'undeliverable', confidence: 'high',
      classification: 'remove', recommendedAction: 'remove', score: 10,
      riskSignals: [{ code: 'disposable', label: 'Disposable domain' }],
      signals: [{ label: 'Disposable / temporary domain', status: 'fail' }],
    }),
    contact({
      email: 'y@corp.com', deliverability: 'unknown', status: 'unknown', confidence: 'low',
      classification: 'unknown', recommendedAction: 'reverify', score: 50, smtpSource: 'none',
      verified_at: '2026-01-01T00:00:00.000Z',
      riskSignals: [],
    }),
    contact({
      email: 'info@corp.com', deliverability: 'deliverable', status: 'deliverable', confidence: 'high',
      classification: 'safe', recommendedAction: 'keep', score: 100,
      riskSignals: [{ code: 'role_based', label: 'Role-based / shared mailbox' }],
    }),
  ];
}

// A list dominated by unknown + missing SMTP evidence -> infrastructure signal.
export function infraFailureContacts() {
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(contact({
    email: `u${i}@corp.com`, deliverability: 'unknown', status: 'unknown', confidence: 'low',
    classification: 'unknown', recommendedAction: 'reverify', score: 50, smtpSource: 'none',
  }));
  for (let i = 0; i < 3; i++) rows.push(contact({ email: `ok${i}@good.com` }));
  return rows;
}

export function history(points) {
  // points: [{ health, safe, review, remove, unknown, at }]
  return points.map((p, i) => ({
    health: p.health,
    metrics: {
      deliverability: p.deliverability ?? 80,
      dataQuality: p.dataQuality ?? 85,
      risk: p.risk ?? 80,
      domainHealth: p.domainHealth ?? 90,
    },
    counts: { safe: p.safe ?? 0, review: p.review ?? 0, remove: p.remove ?? 0, unknown: p.unknown ?? 0 },
    created_at: p.at ?? `2026-0${i + 1}-01T00:00:00.000Z`,
  }));
}

export const CAPABILITY_NO_SMTP = { liveSmtp: false, smtpSource: 'none', smtpMode: 'auto', smtpDetail: 'outbound port 25 blocked' };
export const CAPABILITY_LIVE = { liveSmtp: true, smtpSource: 'local-smtp', smtpMode: 'auto', smtpDetail: 'connected' };
