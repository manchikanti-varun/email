// Worker health + self-test. Determines whether this worker actually has
// outbound port 25 by attempting a connection to a well-known MX. The main app
// uses this to decide whether to route SMTP jobs here.
import { smtpConversation } from './smtp-probe.js';

const stats = {
  probes: 0,
  connections: 0,
  timeouts: 0,
  connFailures: 0,
  accepted: 0,
  rejected: 0,
  temporary: 0,
  catchAll: 0,
  unknown: 0,
  latencySum: 0,
  activeJobs: 0,
};

export const metrics = {
  record(evidence) {
    stats.probes += 1;
    if (evidence.connected) stats.connections += 1;
    if (evidence.error === 'timeout') stats.timeouts += 1;
    else if (evidence.error) stats.connFailures += 1;
    if (typeof evidence.responseTimeMs === 'number') stats.latencySum += evidence.responseTimeMs;
    switch (evidence.status) {
      case 'accepted': stats.accepted += 1; break;
      case 'rejected': stats.rejected += 1; break;
      case 'temporary': stats.temporary += 1; break;
      default: stats.unknown += 1;
    }
    if (evidence.catchAll) stats.catchAll += 1;
  },
  incActive() { stats.activeJobs += 1; },
  decActive() { stats.activeJobs = Math.max(0, stats.activeJobs - 1); },
  snapshot() {
    const avg = stats.probes ? Math.round(stats.latencySum / stats.probes) : 0;
    return { ...stats, avgLatencyMs: avg };
  },
};

let cachedPort25 = { at: 0, ok: null };

// Live check for outbound port 25 (cached briefly). Connects to a public MX.
export async function checkOutboundPort25(config) {
  if (Date.now() - cachedPort25.at < 60_000 && cachedPort25.ok !== null) return cachedPort25.ok;
  const res = await smtpConversation('gmail-smtp-in.l.google.com', {
    from: config.mailFrom, ehlo: config.ehloName, recipients: [],
    timeoutMs: Math.min(config.connectTimeoutMs, 6000),
  });
  cachedPort25 = { at: Date.now(), ok: !!res.connected };
  return cachedPort25.ok;
}

export function activeJobs() { return stats.activeJobs; }
