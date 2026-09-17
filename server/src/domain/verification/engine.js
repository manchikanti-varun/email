// Email List Health & Deliverability engine.
//
// Design principle: never equate a single email characteristic with "health".
// The engine produces INDEPENDENT dimensions and only combines them at the end
// into a recommended action:
//
//   Evidence  →  Confidence  →  Classification  →  Explanation  →  Action
//
// Dimensions returned per address:
//   deliverability   : 'deliverable' | 'undeliverable' | 'risky' | 'unknown'
//   deliverabilityScore : 0-100 technical score (NOT penalised for being role-based)
//   confidence       : 'high' | 'medium' | 'low' | 'unknown'
//   riskSignals      : [ { code, label, detail } ]  descriptive characteristics
//   recommendedAction: 'keep' | 'review' | 'remove' | 'reverify'
//   evidence         : [ { status, label } ]  observable technical checks
//   reasons          : plain-language explanation
//   recommendation   : what the sender should do and why
//
// Lack of evidence is NEVER converted into negative evidence.
//
// This is pure domain logic: network access arrives through injected ports
// (DnsResolver, SmtpProbe, VerificationProvider) and datasets through
// ReferenceData. The engine itself imports no framework or Node network module.
import { normalizeEmail, checkSyntax, parseEmail } from './syntax.js';

function evidence(status, label) { return { status, label }; }
function risk(code, label, detail) { return { code, label, detail }; }

export const DELIVERABILITY = {
  DELIVERABLE: 'deliverable',
  UNDELIVERABLE: 'undeliverable',
  RISKY: 'risky',
  UNKNOWN: 'unknown',
};
export const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown' };
export const ACTION = { KEEP: 'keep', REVIEW: 'review', REMOVE: 'remove', REVERIFY: 'reverify' };

export class VerificationEngine {
  /**
   * @param {object} deps
   * @param {import('../ports/index.js').DnsResolver} deps.dnsResolver
   * @param {import('../ports/index.js').SmtpProbe} deps.smtpProbe
   * @param {() => import('../ports/index.js').VerificationProvider} deps.getProvider
   * @param {import('./reference-data.js').ReferenceData} deps.referenceData
   */
  constructor({ dnsResolver, smtpProbe, getProvider, referenceData }) {
    this.dns = dnsResolver;
    this.smtp = smtpProbe;
    this.getProvider = getProvider;
    this.ref = referenceData;
  }

  // Pre-resolve DNS for a batch of emails so individual verify() calls hit the
  // in-process cache instead of re-resolving the same domains. For a bulk run
  // with many addresses on the same domain this eliminates redundant DNS queries
  // and avoids the thundering-herd problem where N concurrent workers all
  // resolve the same MX before any result is cached.
  async preResolveDomains(emails = []) {
    const domains = new Set();
    for (const raw of emails) {
      const email = normalizeEmail(raw);
      const { domain } = parseEmail(email);
      if (domain) domains.add(domain);
    }
    // Resolve all unique domains in parallel. Errors are swallowed — individual
    // verify() calls will handle missing DNS gracefully.
    await Promise.allSettled(
      [...domains].map((d) => this.dns.resolveDomain(d).catch(() => null)),
    );
  }

  async verify(rawEmail, options = {}) {
    const useProvider = options.useProvider !== false;
    const email = normalizeEmail(rawEmail);

    const ev = [];
    const risks = [];
    const reasons = [];

    // STEP 1 — SYNTAX
    const syn = checkSyntax(email);
    if (!syn.valid) {
      ev.push(evidence('fail', 'Invalid syntax'));
      reasons.push(
        'The address is not a valid email format' +
          (syn.issues.length ? ': ' + syn.issues.join('; ') + '.' : '.')
      );
      return finalize(email, {
        deliverability: DELIVERABILITY.UNDELIVERABLE,
        deliverabilityScore: 0,
        confidence: CONFIDENCE.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. The address is malformed and cannot receive mail.',
      });
    }
    ev.push(evidence('pass', 'Valid syntax'));

    const { local, domain } = parseEmail(email);

    // STEP 2 — RESERVED / DOCUMENTATION DOMAIN
    if (this.ref.isReservedDomain(domain)) {
      ev.push(evidence('fail', 'Reserved / documentation domain'));
      reasons.push(
        `"${domain}" is a reserved domain (RFC 2606/6761) that exists only for ` +
          'documentation and testing and cannot receive real email.'
      );
      return finalize(email, {
        deliverability: DELIVERABILITY.UNDELIVERABLE,
        deliverabilityScore: 0,
        confidence: CONFIDENCE.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. Reserved/example domains cannot receive mail.',
      });
    }

    // Typo hint (a risk characteristic, not a verdict).
    const typo = this.ref.typoSuggestion(domain);
    if (typo) {
      risks.push(risk('possible_typo', 'Possible domain typo',
        `"${domain}" closely resembles "${typo}" and may be a typo.`));
      ev.push(evidence('warn', `Possible typo (did you mean ${typo}?)`));
    }

    // STEP 3 — DISPOSABLE
    if (this.ref.isDisposable(domain)) {
      ev.push(evidence('fail', 'Disposable / temporary domain'));
      risks.push(risk('disposable', 'Disposable domain',
        'This domain provides temporary, throwaway mailboxes that are abandoned quickly.'));
      reasons.push(
        'This is a disposable (temporary) email domain. Such mailboxes are ' +
          'abandoned quickly, so contacting them wastes send volume and harms reputation.'
      );
      return finalize(email, {
        deliverability: DELIVERABILITY.UNDELIVERABLE,
        deliverabilityScore: 10,
        confidence: CONFIDENCE.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. Disposable/temporary mailboxes should not be contacted.',
      });
    }
    ev.push(evidence('pass', 'Not disposable'));

    // STEP 4 — ROLE-BASED (a characteristic, never a health penalty)
    const role = this.ref.isRole(local);
    if (role) {
      risks.push(risk('role_based', 'Role-based / shared mailbox',
        `"${local}@" is a functional/shared mailbox (e.g. a team inbox) rather ` +
        'than an individual person. It may be perfectly deliverable.'));
      ev.push(evidence('info', 'Role-based / shared mailbox'));
    } else {
      ev.push(evidence('pass', 'Individual (not role-based)'));
    }

    // STEP 5 — DOMAIN / DNS / MX
    const dnsResult = await this.dns.resolveDomain(domain);
    if (!dnsResult.domainExists) {
      ev.push(evidence('fail', 'Domain does not exist'));
      risks.push(risk('domain_missing', 'Domain has no DNS records',
        `"${domain}" does not resolve, so it cannot receive mail.`));
      reasons.push(`The domain "${domain}" has no DNS records, so mail cannot be delivered.`);
      return finalize(email, {
        deliverability: DELIVERABILITY.UNDELIVERABLE,
        deliverabilityScore: 5,
        confidence: CONFIDENCE.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. The domain does not exist and mail will bounce.',
      });
    }
    ev.push(evidence('pass', 'Domain exists'));

    if (dnsResult.hasMx) {
      ev.push(evidence('pass', 'MX records found'));
    } else if (dnsResult.aRecord) {
      ev.push(evidence('warn', 'No MX record (implicit A record)'));
      risks.push(risk('no_mx', 'No dedicated mail servers',
        'The domain has no MX records; mail may still be accepted via its A record but this is less reliable.'));
    }

    // STEP 6 — SMTP MAILBOX PROBE (via the SMTP router: local or worker)
    const smtp = await this.smtp.check(email, dnsResult.mxHosts);
    const smtpSource = smtp.source || (smtp.skipped ? 'none' : null);
    let catchAll = false;
    let smtpProbed = false;
    let smtpUnavailable = false;

    // mxUnreachable = we attempted SMTP but no MX completed a handshake.
    // Distinct from "port 25 blocked here" so the UI does not blame our network
    // when only this domain's mail servers were unreachable.
    let mxUnreachable = false;

    if (smtp.skipped) {
      smtpUnavailable = true;
      ev.push(evidence('info', 'SMTP probe not performed (disabled here)'));
    } else if (smtp.inconclusive) {
      smtpUnavailable = true;
      mxUnreachable = !!(smtp.mxUnreachable || smtp.triedHosts?.length);
      if (mxUnreachable) {
        ev.push(evidence('info', 'Mail servers did not complete an SMTP handshake'));
      } else {
        ev.push(evidence('info', 'SMTP could not be probed (outbound port 25 unavailable)'));
      }
    } else if (smtp.reachable === false) {
      smtpUnavailable = true;
      mxUnreachable = true;
      ev.push(evidence('info', 'Mail server did not complete an SMTP handshake'));
    } else if (smtp.reachable) {
      smtpProbed = true;
      ev.push(evidence('pass', 'SMTP server responds'));
      if (smtp.catchAll) {
        catchAll = true;
        ev.push(evidence('warn', 'Catch-all domain'));
        risks.push(risk('catch_all', 'Catch-all domain',
          'The server accepts mail for any address, so this specific mailbox cannot be independently confirmed.'));
      } else if (smtp.mailboxExists) {
        ev.push(evidence('pass', 'Mailbox confirmed to exist'));
      } else if (smtp.mailboxRejected) {
        ev.push(evidence('fail', 'Mailbox rejected by server'));
      } else if (smtp.temporaryFailure) {
        ev.push(evidence('warn', 'Temporary failure / greylisting'));
        risks.push(risk('temporary_failure', 'Temporary failure',
          'The server returned a temporary error (e.g. greylisting); a later retry may resolve it.'));
      }
    }

    const greylisted = !!(smtp.reachable && smtp.temporaryFailure);
    const mailboxRejected = !!(smtp.reachable && smtp.mailboxRejected);

    // STEP 7 — EXTERNAL PROVIDER (only if local evidence is inconclusive)
    let provider = null;
    const localInconclusive =
      smtpUnavailable || greylisted ||
      (smtp.reachable && !smtp.mailboxExists && !smtp.mailboxRejected && !catchAll);

    if (useProvider && dnsResult.domainExists && localInconclusive) {
      try {
        const p = await this.getProvider().verify(email, {
          domainExists: dnsResult.domainExists, hasMx: dnsResult.hasMx, catchAll,
        });
        if (p.provider !== 'none') {
          provider = p;
          if (p.deliverable === true) ev.push(evidence('pass', `Deliverable per provider (${p.provider})`));
          else if (p.deliverable === false) ev.push(evidence('fail', `Undeliverable per provider (${p.provider})`));
          else if (p.catchAll) { catchAll = true; ev.push(evidence('warn', `Catch-all per provider (${p.provider})`)); }
        }
      } catch {
        ev.push(evidence('info', 'Provider lookup unavailable'));
      }
    }

    // COMBINE
    const facts = {
      mailboxConfirmed: (smtpProbed && smtp.mailboxExists) || (provider && provider.deliverable === true),
      mailboxRejected: mailboxRejected || (provider && provider.deliverable === false),
      catchAll,
      greylisted,
      smtpUnavailable,
      mxUnreachable,
      hasMx: dnsResult.hasMx,
      aOnly: dnsResult.aRecord && !dnsResult.hasMx,
      role,
      risks,
    };

    const deliverability = assessDeliverability(facts);
    const confidence = assessConfidence(facts);
    const deliverabilityScore = scoreDeliverability(facts, deliverability);
    const recommendedAction = recommendAction({ deliverability, confidence, facts });

    buildReasons({ reasons, deliverability, confidence, facts });

    return finalize(email, {
      deliverability,
      deliverabilityScore,
      confidence,
      riskSignals: risks,
      recommendedAction,
      evidence: ev,
      reasons,
      recommendation: recommendationText({ deliverability, confidence, recommendedAction, facts }),
      greylisted,
      provider: provider?.provider || null,
      smtpSource,
    });
  }
}

// ---- Dimension 1: technical deliverability --------------------------------
function assessDeliverability(f) {
  if (f.mailboxRejected) return DELIVERABILITY.UNDELIVERABLE;
  if (f.mailboxConfirmed) return DELIVERABILITY.DELIVERABLE;
  if (f.catchAll) return DELIVERABILITY.RISKY;
  return DELIVERABILITY.UNKNOWN;
}

// ---- Dimension 2: strength of evidence ------------------------------------
function assessConfidence(f) {
  if (f.mailboxConfirmed || f.mailboxRejected) return CONFIDENCE.HIGH;
  if (f.catchAll) return CONFIDENCE.MEDIUM;
  if (f.greylisted) return CONFIDENCE.LOW;
  if (f.smtpUnavailable) return f.hasMx ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
  return CONFIDENCE.LOW;
}

// ---- Technical deliverability score (0-100) -------------------------------
function scoreDeliverability(f, deliverability) {
  if (deliverability === DELIVERABILITY.UNDELIVERABLE) return 5;
  if (deliverability === DELIVERABILITY.DELIVERABLE) return 100;
  if (deliverability === DELIVERABILITY.RISKY) return 55;

  let score = 50;
  if (f.hasMx) score += 20;
  else if (f.aOnly) score += 5;
  if (f.greylisted) score -= 5;
  return Math.max(0, Math.min(75, score));
}

// ---- Recommended action ---------------------------------------------------
function recommendAction({ deliverability, facts }) {
  if (deliverability === DELIVERABILITY.UNDELIVERABLE) return ACTION.REMOVE;
  if (deliverability === DELIVERABILITY.DELIVERABLE) return ACTION.KEEP;
  if (deliverability === DELIVERABILITY.RISKY) return ACTION.REVIEW;
  if (facts.smtpUnavailable || facts.greylisted) return ACTION.REVERIFY;
  return ACTION.REVIEW;
}

// ---- Explanation ----------------------------------------------------------
function buildReasons({ reasons, deliverability, confidence, facts }) {
  if (deliverability === DELIVERABILITY.DELIVERABLE) {
    reasons.push('The mailbox was directly confirmed to exist and can receive mail.');
  } else if (deliverability === DELIVERABILITY.RISKY && facts.catchAll) {
    reasons.push(
      'The domain is catch-all: it accepts mail for any address, so this specific ' +
      'mailbox cannot be independently confirmed. The address may well be valid.'
    );
  } else if (deliverability === DELIVERABILITY.UNKNOWN) {
    if (facts.mxUnreachable) {
      reasons.push(
        'Syntax, domain and MX records are healthy, but none of the domain\'s mail ' +
        'servers completed an SMTP handshake from this verifier. The mailbox is ' +
        'unconfirmed, not undeliverable.'
      );
    } else if (facts.smtpUnavailable) {
      reasons.push(
        'Syntax, domain and MX records are healthy, but mailbox existence could not ' +
        'be directly confirmed because SMTP probing was unavailable. This is unconfirmed, ' +
        'not undeliverable.'
      );
    } else if (facts.greylisted) {
      reasons.push('The server returned a temporary (greylisting) response; a retry later should resolve it.');
    } else {
      reasons.push('Domain and MX are healthy, but the mailbox itself was not confirmed.');
    }
  }
  if (facts.role) {
    reasons.push(
      'This is a shared/functional mailbox (e.g. a team inbox) rather than an ' +
      'individual mailbox. Consider whether this type of address suits the campaign — ' +
      'it is not, by itself, a sign of poor health.'
    );
  }
  reasons.push(`Evidence confidence: ${confidence}.`);
}

function recommendationText({ recommendedAction, facts }) {
  switch (recommendedAction) {
    case ACTION.REMOVE:
      return 'REMOVE — strong technical evidence this address cannot receive mail.';
    case ACTION.KEEP:
      return facts.role
        ? 'KEEP — deliverable. Note: this is a shared/role mailbox; confirm it suits your campaign.'
        : 'KEEP — deliverable with high confidence.';
    case ACTION.REVERIFY:
      return 'REVERIFY — technically plausible, but the mailbox could not be confirmed here. ' +
             'Re-check where live SMTP verification is available.';
    case ACTION.REVIEW:
    default:
      return facts.catchAll
        ? 'REVIEW — catch-all domain; the mailbox cannot be independently confirmed. ' +
          'Safe to keep for low-volume/known contacts; verify before large campaigns.'
        : 'REVIEW — evidence is mixed; a human decision is recommended.';
  }
}

function finalize(email, r) {
  return {
    email,
    deliverability: r.deliverability,
    deliverabilityScore: r.deliverabilityScore,
    confidence: r.confidence,
    riskSignals: r.riskSignals || [],
    recommendedAction: r.recommendedAction,
    evidence: r.evidence || [],
    reasons: r.reasons || [],
    recommendation: r.recommendation,

    // ---- Backward-compatible derived fields ----
    score: r.deliverabilityScore,
    classification: mapAction(r.recommendedAction),
    status: r.deliverability,
    signals: r.evidence || [],
    greylisted: r.greylisted || false,
    provider: r.provider || null,
    // Which SMTP path produced the evidence: 'local-smtp' | 'smtp-worker' |
    // 'none'. Additive/transparency field; kept in the evidence trail.
    smtpSource: r.smtpSource || null,
    verified_at: new Date().toISOString(),
  };
}

function mapAction(action) {
  switch (action) {
    case ACTION.KEEP: return 'safe';
    case ACTION.REMOVE: return 'remove';
    case ACTION.REVERIFY: return 'unknown';
    case ACTION.REVIEW:
    default: return 'review';
  }
}
