// Agent guardrails: what the agent is and isn't allowed to do, plus data
// hygiene helpers. These are enforced in code (executor/planner), not merely
// requested in the prompt.
//
// Core invariants (see also prompts.js):
//   - The deterministic verification engine is the ONLY source of truth for
//     syntax/DNS/MX/SMTP/catch-all/disposable/role/provider/deliverability.
//   - The agent MUST NOT invent verification results. It may only report what a
//     tool actually returned.
//   - "unknown" deliverability stays "unknown" — never upgraded to deliverable
//     nor downgraded to undeliverable by the agent.
//   - AI recommendations are labelled as such and kept distinct from verified
//     facts.

// Keys that must never leave the process in a prompt or an audit log.
const SECRET_KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|bearer|jwt|hash)/i;

// Recursively redact secret-looking keys from any object we might log or send
// to a provider. Returns a safe copy.
export function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) out[k] = '[redacted]';
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Minimise personal data before sending context to an external provider. We
// keep aggregate metrics and verdicts; we DROP raw email addresses beyond a
// small sample and mask the sample's local-part.
export function minimizeForPrompt(context) {
  const clone = redact(context);
  if (clone && Array.isArray(clone.sampleContacts)) {
    clone.sampleContacts = clone.sampleContacts.slice(0, 5).map((c) => ({
      email: maskEmail(c.email),
      deliverability: c.deliverability,
      classification: c.classification,
      confidence: c.confidence,
    }));
  }
  return clone;
}

export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '[email]';
  const [local, domain] = email.split('@');
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? '***' : ''}@${domain}`;
}

// The deterministic verdict fields the agent may quote as VERIFIED facts.
export const VERIFIED_FIELDS = Object.freeze([
  'deliverability', 'confidence', 'recommendedAction', 'score',
  'classification', 'riskSignals', 'evidence', 'health', 'counts', 'metrics',
]);

// Iteration cap guard. Returns true when the loop must stop.
export function shouldStop(iterations, max) {
  return iterations >= max;
}
