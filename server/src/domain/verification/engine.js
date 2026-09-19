// Email List Health & Deliverability engine.
//
// Design principle: never equate a single email characteristic with "health".
// The engine produces INDEPENDENT dimensions and only combines them at the end
// into a recommended action:
//
//   Evidence  →  Confidence  →  Classification  →  Explanation  →  Action
//
// Dimensions returned per address:
//   deliverability   : 'deliverable' | 'accepted' | 'undeliverable' | 'risky' | 'unknown'
//   deliverabilityScore : 0-100 — only reduced by actual negative evidence
//   confidence       : 'high' | 'medium' | 'low' | 'unknown'
//   mailboxStatus    : 'DELIVERABLE' | 'UNDELIVERABLE' | 'ACCEPT_ALL' | 'UNKNOWN'
//   acceptanceType   : 'CATCH_ALL' | null  (set when status is accepted via catch-all)
//   verificationQuality : 'HIGH' | 'MEDIUM' | 'LOW'
//   riskSignals      : [ { code, label, detail } ]  descriptive characteristics
//   recommendedAction: 'keep' | 'review' | 'remove' | 'reverify'
//   evidence         : [ { status, label } ]  observable technical checks
//   smtpEvidence     : structured MX/SMTP/vantage trail
//   reasons          : plain-language explanation
//   recommendation   : what the sender should do and why
//
// Catch-all is POSITIVE mail-infrastructure evidence (server accepts the
// recipient). It is NEVER a REVIEW/health penalty — only a note that the
// exact mailbox cannot be independently proven.
// Lack of evidence is NEVER converted into negative evidence.
//
// This is pure domain logic: network access arrives through injected ports
// (DnsResolver, SmtpProbe, VerificationProvider) and datasets through
// ReferenceData. The engine itself imports no framework or Node network module.
import { normalizeEmail, checkSyntax, parseEmail } from './syntax.js';
import {
  MAILBOX_STATUS,
  VERIFICATION_QUALITY,
  toMailboxStatus,
  toVerificationQuality,
} from './smtp-classify.js';
import { classificationFor as canonicalClassificationFor } from './verdict-semantics.js';

function evidence(status, label) { return { status, label }; }
function risk(code, label, detail) { return { code, label, detail }; }

export const DELIVERABILITY = {
  DELIVERABLE: 'deliverable',
  ACCEPTED: 'accepted', // catch-all / positive accept without proven mailbox
  UNDELIVERABLE: 'undeliverable',
  RISKY: 'risky',
  UNKNOWN: 'unknown',
};

/** Additive type tag when deliverability is accepted via catch-all. */
export const ACCEPTANCE_TYPE = {
  CATCH_ALL: 'CATCH_ALL',
};
export const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown' };
export const ACTION = { KEEP: 'keep', REVIEW: 'review', REMOVE: 'remove', REVERIFY: 'reverify' };

export { MAILBOX_STATUS, VERIFICATION_QUALITY };

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
        mailboxStatus: MAILBOX_STATUS.UNDELIVERABLE,
        verificationQuality: VERIFICATION_QUALITY.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. The address is malformed and cannot receive mail.',
        finalReason: 'invalid_syntax',
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
        mailboxStatus: MAILBOX_STATUS.UNDELIVERABLE,
        verificationQuality: VERIFICATION_QUALITY.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. Reserved/example domains cannot receive mail.',
        finalReason: 'reserved_domain',
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
        mailboxStatus: MAILBOX_STATUS.UNDELIVERABLE,
        verificationQuality: VERIFICATION_QUALITY.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. Disposable/temporary mailboxes should not be contacted.',
        finalReason: 'disposable_domain',
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
        mailboxStatus: MAILBOX_STATUS.UNDELIVERABLE,
        verificationQuality: VERIFICATION_QUALITY.HIGH,
        riskSignals: risks,
        recommendedAction: ACTION.REMOVE,
        evidence: ev,
        reasons,
        recommendation: 'Remove. The domain does not exist and mail will bounce.',
        finalReason: 'domain_missing',
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

    // STEP 6 — SMTP MAILBOX PROBE (via the SMTP router: local and/or worker)
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
      } else if (smtp.smtpClass === 'timeout' || smtp.error === 'timeout' || smtp.error === 'worker-timeout') {
        ev.push(evidence('info', 'SMTP probe timed out (unconfirmed)'));
      } else if (smtp.smtpClass === 'connection_refused') {
        ev.push(evidence('info', 'SMTP connection refused (unconfirmed)'));
      } else if (smtp.smtpClass === 'tls_failure') {
        ev.push(evidence('info', 'SMTP TLS failure (unconfirmed)'));
      } else if (smtp.smtpClass === 'rate_limited' || smtp.smtpClass === 'blocked') {
        ev.push(evidence('info', 'SMTP path rate-limited or blocked (unconfirmed)'));
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
        // Informational, not a failure: domain mail path is healthy; mailbox
        // identity alone is unconfirmed.
        ev.push(evidence('info', 'Catch-all domain (mail path healthy)'));
        risks.push(risk('catch_all', 'Catch-all · accepted',
          'Accepted by a catch-all mail server. Individual mailbox existence cannot ' +
          'be independently confirmed.'));
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
    // Catch-all MUST win over a raw 250 on the real address — both accepting
    // proves ACCEPT_ALL, not DELIVERABLE.
    const mailboxConfirmed = !catchAll && (
      (smtpProbed && smtp.mailboxExists) || false
    );

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

    const providerConfirmed = !!(provider && provider.deliverable === true && !catchAll);
    const providerRejected = !!(provider && provider.deliverable === false);

    // COMBINE
    const facts = {
      mailboxConfirmed: mailboxConfirmed || providerConfirmed,
      mailboxRejected: mailboxRejected || providerRejected,
      catchAll,
      greylisted,
      smtpUnavailable,
      mxUnreachable,
      hasMx: dnsResult.hasMx,
      aOnly: dnsResult.aRecord && !dnsResult.hasMx,
      role,
      risks,
      multiVantageAgree: !!smtp.multiVantageAgree,
    };

    const deliverability = assessDeliverability(facts);
    const confidence = assessConfidence(facts);
    const deliverabilityScore = scoreDeliverability(facts, deliverability);
    const recommendedAction = recommendAction({ deliverability, confidence, facts });
    const mailboxStatus = toMailboxStatus(facts);
    const verificationQuality = toVerificationQuality(facts);

    const smtpEvidence = buildSmtpEvidence(smtp, {
      finalReason: finalReasonFor({ deliverability, facts, smtp }),
    });

    buildReasons({ reasons, deliverability, confidence, facts, mailboxStatus });

    return finalize(email, {
      deliverability,
      deliverabilityScore,
      confidence,
      mailboxStatus,
      verificationQuality,
      acceptanceType: facts.catchAll ? ACCEPTANCE_TYPE.CATCH_ALL : null,
      riskSignals: risks,
      recommendedAction,
      evidence: ev,
      reasons,
      recommendation: recommendationText({ deliverability, confidence, recommendedAction, facts, mailboxStatus }),
      greylisted,
      provider: provider?.provider || null,
      smtpSource,
      smtpEvidence,
      finalReason: smtpEvidence.finalReason,
    });
  }
}

// ---- Dimension 1: technical deliverability --------------------------------
// Catch-all → ACCEPTED (positive). Never REVIEW solely for unconfirmed mailbox.
function assessDeliverability(f) {
  if (f.mailboxRejected) return DELIVERABILITY.UNDELIVERABLE;
  if (f.catchAll) return DELIVERABILITY.ACCEPTED;
  if (f.mailboxConfirmed) return DELIVERABILITY.DELIVERABLE;
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
// Only actual negative evidence reduces the score. Catch-all / unknown SMTP
// incompleteness are NOT penalties.
function scoreDeliverability(f, deliverability) {
  if (deliverability === DELIVERABILITY.UNDELIVERABLE) return 5;
  if (deliverability === DELIVERABILITY.DELIVERABLE) return 100;
  if (deliverability === DELIVERABILITY.ACCEPTED) return 100; // positive, no penalty
  if (deliverability === DELIVERABILITY.RISKY) return 55; // reserved for real risk signals

  // UNKNOWN: neutral — credit healthy domain/MX, do not punish inconclusive SMTP.
  let score = 72;
  if (f.hasMx) score = 80;
  else if (f.aOnly) score = 70;
  return Math.max(0, Math.min(85, score));
}

// ---- Recommended action ---------------------------------------------------
function recommendAction({ deliverability, facts }) {
  if (deliverability === DELIVERABILITY.UNDELIVERABLE) return ACTION.REMOVE;
  if (deliverability === DELIVERABILITY.DELIVERABLE) return ACTION.KEEP;
  // Catch-all (ACCEPTED) is NOT confirmed mailbox existence. The server accepts
  // arbitrary recipients, so the specific mailbox cannot be independently
  // proven. It is REVIEW (human decision), never an automatic KEEP/Safe.
  if (deliverability === DELIVERABILITY.ACCEPTED) return ACTION.REVIEW;
  if (facts.smtpUnavailable || facts.greylisted) return ACTION.REVERIFY;
  return ACTION.REVIEW;
}

function finalReasonFor({ deliverability, facts, smtp }) {
  if (smtp?.smtpEvidence?.finalReason) return smtp.smtpEvidence.finalReason;
  if (deliverability === DELIVERABILITY.UNDELIVERABLE) return 'definitive_recipient_rejection';
  if (facts.catchAll) return 'catch_all_domain';
  if (deliverability === DELIVERABILITY.DELIVERABLE) return 'mailbox_accepted';
  if (facts.greylisted) return 'temporary_failure';
  if (facts.mxUnreachable) return 'all_mx_unreachable';
  if (facts.smtpUnavailable) return 'smtp_unavailable';
  return 'unconfirmed';
}

function buildSmtpEvidence(smtp, { finalReason }) {
  const base = smtp?.smtpEvidence && typeof smtp.smtpEvidence === 'object'
    ? { ...smtp.smtpEvidence }
    : {
      vantages: smtp ? [{
        vantage: smtp.vantage || smtp.source || 'unknown',
        source: smtp.source || null,
        reachable: smtp.reachable,
        inconclusive: !!(smtp.inconclusive || smtp.skipped),
        mailboxExists: !!smtp.mailboxExists,
        mailboxRejected: !!smtp.mailboxRejected,
        temporaryFailure: !!smtp.temporaryFailure,
        catchAll: !!smtp.catchAll,
        code: smtp.code ?? null,
        error: smtp.error || null,
        smtpClass: smtp.smtpClass || null,
        mxHost: smtp.mxHost || null,
        triedHosts: smtp.triedHosts || [],
        workerId: smtp.workerId || null,
        responseTimeMs: smtp.responseTimeMs ?? null,
      }] : [],
      mxAttempts: smtp?.mxAttempts || [],
      retries: smtp?.attempts || smtp?.retries || 0,
      catchAll: !!smtp?.catchAll,
      worker: smtp?.workerId ? { id: smtp.workerId } : null,
    };

  return {
    ...base,
    finalReason: finalReason || base.finalReason || 'unconfirmed',
    catchAll: base.catchAll ?? !!smtp?.catchAll,
  };
}

// ---- Explanation ----------------------------------------------------------
function buildReasons({ reasons, deliverability, confidence, facts, mailboxStatus }) {
  if (mailboxStatus === MAILBOX_STATUS.ACCEPT_ALL || deliverability === DELIVERABILITY.ACCEPTED || facts.catchAll) {
    reasons.push(
      'Accepted by a catch-all mail server. Individual mailbox existence cannot be ' +
      'independently confirmed. Mail infrastructure is healthy — this is not a failure.'
    );
  } else if (deliverability === DELIVERABILITY.DELIVERABLE) {
    reasons.push('The mailbox was directly confirmed to exist and can receive mail.');
  } else if (deliverability === DELIVERABILITY.UNKNOWN) {
    if (facts.mxUnreachable) {
      reasons.push(
        'Syntax, domain and MX records are healthy, but none of the domain\'s mail ' +
        'servers completed an SMTP handshake from this verifier. The mailbox is ' +
        'unconfirmed, not undeliverable.'
      );
    } else if (facts.greylisted) {
      reasons.push('The server returned a temporary (greylisting) response; a retry later should resolve it.');
    } else if (facts.smtpUnavailable) {
      reasons.push(
        'Syntax, domain and MX records are healthy, but mailbox existence could not ' +
        'be directly confirmed because SMTP probing was unavailable. This is unconfirmed, ' +
        'not undeliverable.'
      );
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

function recommendationText({ recommendedAction, facts, mailboxStatus }) {
  switch (recommendedAction) {
    case ACTION.REMOVE:
      return 'REMOVE — strong technical evidence this address cannot receive mail.';
    case ACTION.KEEP:
      return facts.role
        ? 'KEEP — deliverable. Note: this is a shared/role mailbox; confirm it suits your campaign.'
        : 'KEEP — deliverable with high confidence.';
    case ACTION.REVERIFY:
      return 'REVERIFY — technically plausible, but the mailbox could not be confirmed here. ' +
             'Re-check where live SMTP verification is available. This is unconfirmed, not invalid.';
    case ACTION.REVIEW:
    default:
      if (mailboxStatus === MAILBOX_STATUS.ACCEPT_ALL || facts.catchAll) {
        return 'REVIEW — Accepted by a catch-all mail server. The domain accepts arbitrary ' +
          'recipients, so this specific mailbox cannot be independently confirmed. A human ' +
          'decision is recommended before sending.';
      }
      return 'REVIEW — evidence indicates real risk or conflicting signals; a human decision is recommended.';
  }
}

function finalize(email, r) {
  return {
    email,
    deliverability: r.deliverability,
    deliverabilityScore: r.deliverabilityScore,
    confidence: r.confidence,
    // Additive proven-mailbox + evidence-quality dimensions (UI/API compatible).
    mailboxStatus: r.mailboxStatus || MAILBOX_STATUS.UNKNOWN,
    verificationQuality: r.verificationQuality || VERIFICATION_QUALITY.LOW,
    acceptanceType: r.acceptanceType || null,
    riskSignals: r.riskSignals || [],
    recommendedAction: r.recommendedAction,
    evidence: r.evidence || [],
    reasons: r.reasons || [],
    recommendation: r.recommendation,
    smtpEvidence: r.smtpEvidence || null,
    finalReason: r.finalReason || null,

    // ---- Backward-compatible derived fields ----
    score: r.deliverabilityScore,
    // Classification is derived from the CANONICAL verdict semantics (single
    // source of truth), NOT re-derived from the action here. This guarantees
    // catch-all → 'review' (not 'safe') everywhere. See verdict-semantics.js.
    classification: canonicalClassificationFor({
      deliverability: r.deliverability,
      status: r.deliverability,
      acceptanceType: r.acceptanceType,
      mailboxStatus: r.mailboxStatus,
      riskSignals: r.riskSignals,
    }),
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

// NOTE: classification is now derived from the canonical verdict-semantics
// module (see finalize → canonicalClassificationFor), not from the action.
// The former mapAction() helper was removed to keep ONE source of truth.
