// Application use-cases for the AI Intelligence Layer.
//
// These orchestrate: they FETCH real deterministic data through the EXISTING
// use-cases/repositories (ownership-checked), then pass it to the PURE
// intelligence modules for interpretation. They contain no verification logic,
// no SQL, and never fabricate results. When data is missing they surface the
// module's "insufficient evidence" response rather than inventing anything.
//
// Everything here works with NO LLM — the intelligence is deterministic
// heuristics. An LLM (when configured) only ever rephrases these results via
// the agent; it never becomes the source of truth.
import { AppError } from './errors.js';
import {
  listStatistics, domainStatistics,
  campaignRisk, listHealthAnalysis, healthPrediction,
  detectAnomalies, detectIncident, domainIntelligence,
  smartCleaning, prioritizeReverification, optimizeCredits, explainEmail,
  businessInsights, analyzeBenchmark, investigate,
} from '../../agent/intelligence/index.js';
import {
  buildDataset, splitDataset, trainModel, predictProba,
  evaluate, selectThresholds, compareRuleVsMl, detectDrift,
} from '../../agent/intelligence/calibration/index.js';

// Shared loader: pulls the full deterministic picture for a list via the
// existing GetListDetail use-case (which enforces ownership). Returns the
// list, summary, contacts, history, plus derived statistics.
class ListDataLoader {
  constructor({ getListDetail }) { this.getListDetail = getListDetail; }
  load(userId, listId) {
    if (!listId || typeof listId !== 'string') throw new AppError(400, 'A valid listId (string) is required');
    const detail = this.getListDetail.execute(userId, listId); // throws 404 if not owned
    const stats = listStatistics(detail.contacts);
    return { ...detail, stats };
  }
}

// ---- Campaign Risk --------------------------------------------------------
export class GetCampaignRisk {
  constructor({ getListDetail, campaignPreflight }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.campaignPreflight = campaignPreflight;
  }
  execute(userId, listId) {
    const { list, stats, history } = this.loader.load(userId, listId);
    let preflight = null;
    try { preflight = this.campaignPreflight.execute(userId, listId); } catch { /* not verified */ }
    const result = campaignRisk({ stats, preflight, history });
    return { list: pubList(list), ...result };
  }
}

// ---- List Health Analysis -------------------------------------------------
export class GetHealthAnalysis {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId) {
    const { list, summary, stats, history } = this.loader.load(userId, listId);
    const result = listHealthAnalysis({ summary, stats, history });
    return { list: pubList(list), ...result };
  }
}

// ---- Health Prediction ----------------------------------------------------
export class GetHealthPrediction {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId) {
    const { list, history } = this.loader.load(userId, listId);
    const result = healthPrediction({ history });
    return { list: pubList(list), ...result };
  }
}

// ---- Anomaly Detection ----------------------------------------------------
export class GetListAnomalies {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId) {
    const { list, history } = this.loader.load(userId, listId);
    const result = detectAnomalies({ history });
    return { list: pubList(list), ...result };
  }
}

// ---- Domain Intelligence --------------------------------------------------
export class GetDomainIntelligence {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId, { limit = 10, minContacts = 1 } = {}) {
    const { list, contacts } = this.loader.load(userId, listId);
    const domainStats = domainStatistics(contacts, { minContacts });
    const result = domainIntelligence({ domainStats, limit });
    return { list: pubList(list), ...result };
  }
}

// ---- Smart Cleaning (prioritise only) -------------------------------------
export class GetSmartCleaning {
  constructor({ getListDetail, getCleaningPlan }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.getCleaningPlan = getCleaningPlan;
  }
  execute(userId, listId) {
    const { list, contacts } = this.loader.load(userId, listId);
    const cleaningPlan = this.getCleaningPlan.execute(userId, listId);
    const result = smartCleaning({ cleaningPlan, contacts });
    return { list: pubList(list), ...result };
  }
}

// ---- Re-verification Prioritisation ---------------------------------------
export class GetReverificationPriority {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId, { limit = 100 } = {}) {
    const { list, contacts } = this.loader.load(userId, listId);
    const result = prioritizeReverification({ contacts });
    // Cap the returned per-contact list; keep bucket totals intact.
    const capped = { ...result, priority: (result.priority || []).slice(0, Math.max(1, Math.min(500, limit))) };
    return { list: pubList(list), ...capped };
  }
}

// ---- Credit Optimisation --------------------------------------------------
export class GetCreditOptimization {
  constructor({ getListDetail, getAccountCredits }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.getAccountCredits = getAccountCredits;
  }
  execute(userId, listId) {
    const { list, contacts } = this.loader.load(userId, listId);
    const prioritized = prioritizeReverification({ contacts });
    const { credits } = this.getAccountCredits.execute(userId);
    const result = optimizeCredits({ prioritized, availableCredits: credits });
    return { list: pubList(list), ...result };
  }
}

// ---- Per-Email Explanation ------------------------------------------------
// Sourced from the list's contacts (ownership enforced by GetListDetail). The
// contact is located by email OR by contact id within the owned list.
export class GetEmailExplanation {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId, { email, contactId, mode = 'simple' } = {}) {
    const { contacts } = this.loader.load(userId, listId);
    const needle = String(email || '').toLowerCase();
    const contact = contacts.find((c) =>
      (contactId && c.id === contactId) || (needle && String(c.email).toLowerCase() === needle));
    if (!contact) throw new AppError(404, 'Contact not found in that list');
    return explainEmail({ contact, mode });
  }
}

// ---- Business Insights ----------------------------------------------------
export class GetBusinessInsights {
  constructor({ getListDetail }) { this.loader = new ListDataLoader({ getListDetail }); }
  execute(userId, listId) {
    const { list, summary, stats, contacts, history } = this.loader.load(userId, listId);
    const domainStats = domainStatistics(contacts);
    const result = businessInsights({ stats, summary, domainStats, history });
    return { list: pubList(list), ...result };
  }
}

// ---- Investigation --------------------------------------------------------
export class InvestigateVerification {
  constructor({ getListDetail, verifyCapability }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.verifyCapability = verifyCapability;
  }
  execute(userId, listId, { question } = {}) {
    const { list, stats, history, contacts } = this.loader.load(userId, listId);
    const domainStats = domainStatistics(contacts);
    const result = investigate({ question, stats, history, capability: this.verifyCapability, domainStats });
    return { list: pubList(list), ...result };
  }
}

// ---- Incident Detection (account-wide or per-list) ------------------------
// Per-list uses the list's stats; account-wide scans the user's lists and
// reports the most severe signal. Never claims an outage without evidence.
export class DetectIncidents {
  constructor({ getListDetail, getLists, verifyCapability }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.getLists = getLists;
    this.verifyCapability = verifyCapability;
  }
  execute(userId, listId) {
    if (listId) {
      const { list, stats } = this.loader.load(userId, listId);
      const result = detectIncident({ stats, capability: this.verifyCapability });
      return { scope: 'list', list: pubList(list), ...result };
    }
    // Account-wide: evaluate each verified list, surface the worst.
    const { lists } = this.getLists.execute(userId);
    const perList = [];
    for (const l of lists) {
      try {
        const { stats } = this.loader.load(userId, l.id);
        if (stats.total === 0) continue;
        const r = detectIncident({ stats, capability: this.verifyCapability });
        perList.push({ listId: l.id, listName: l.name, ...r });
      } catch { /* skip */ }
    }
    const incidents = perList.filter((r) => r.incident);
    const sev = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    incidents.sort((a, b) => (sev[b.severity] || 0) - (sev[a.severity] || 0));
    return {
      scope: 'account',
      capability: pubCapability(this.verifyCapability),
      incidentCount: incidents.length,
      incidents,
      evaluatedLists: perList.length,
      message: incidents.length ? `${incidents.length} list(s) show a possible incident signal.` : 'No incident signals across your lists.',
    };
  }
}

// ---- Benchmark / Confidence Calibration -----------------------------------
// Accepts a benchmark result payload (from `npm run benchmark`, bring-your-own
// labelled dataset). Read-only analysis; never mutates verdicts.
export class AnalyzeBenchmark {
  execute(_userId, { benchmark } = {}) {
    return analyzeBenchmark({ benchmark });
  }
}

// ---- ML Confidence Calibration (per-contact) ------------------------------
// Estimates P(correct verdict | evidence) for one contact in an OWNED list.
// The deterministic verdict is passed through UNCHANGED; a `confidence` block
// is added alongside it. If the ML model is unavailable, the block honestly
// reports the deterministic fallback. This never charges credits and never
// re-runs verification.
export class CalibrateVerificationConfidence {
  constructor({ getListDetail, calibrator }) {
    this.loader = new ListDataLoader({ getListDetail });
    this.calibrator = calibrator;
  }
  execute(userId, listId, { email, contactId } = {}) {
    const { contacts } = this.loader.load(userId, listId);
    const needle = String(email || '').toLowerCase();
    const contact = contacts.find((c) =>
      (contactId && c.id === contactId) || (needle && String(c.email).toLowerCase() === needle));
    if (!contact) throw new AppError(404, 'Contact not found in that list');

    const confidence = this.calibrator.calibrate(contact);
    // Pass the deterministic verdict through unchanged; ADD confidence.
    return {
      email: contact.email,
      verdict: contact.deliverability || contact.status || 'unknown',
      deliverabilityScore: contact.deliverabilityScore ?? contact.score ?? null,
      recommendedAction: contact.recommendedAction || contact.classification,
      riskSignals: contact.riskSignals || [],
      confidence,
    };
  }
}

// ---- ML Confidence Calibration (single ad-hoc result) ---------------------
// Calibrates an already-computed deterministic result object (e.g. from a
// single-email verification). Does not re-verify; purely additive.
export class CalibrateSingleResult {
  constructor({ calibrator }) { this.calibrator = calibrator; }
  execute(_userId, result) {
    if (!result || typeof result !== 'object') throw new AppError(400, 'A verification result is required');
    return this.calibrator.calibrate(result);
  }
}

// ---- Calibration Benchmark Dashboard --------------------------------------
// Trains a CANDIDATE calibrator on a supplied labelled dataset in-memory and
// reports whether rule+ML beats the deterministic engine's own confidence.
// This is an evaluation surface (task §21) — it NEVER deploys a model and
// NEVER changes verdicts. When data is insufficient it says so.
export class GetCalibrationBenchmark {
  execute(_userId, { dataset } = {}) {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      return {
        available: false,
        message: 'ML Confidence Calibration: UNAVAILABLE\nReason: Insufficient validated benchmark samples.',
      };
    }
    const ds = buildDataset(dataset);
    if (ds.scorable < 20) {
      return {
        available: false,
        scorable: ds.scorable,
        sources: ds.sources,
        message: 'ML Confidence Calibration: UNAVAILABLE\nReason: Insufficient validated benchmark samples (need >= 20).',
      };
    }
    const { train, validation, test } = splitDataset(ds.records, { groupBy: 'domain' });
    const model = trainModel(train, { minSamples: 20 });
    if (!model.trained) {
      return { available: false, reason: model.reason, message: 'ML Confidence Calibration: UNAVAILABLE\nReason: model could not be trained on the supplied data.' };
    }
    const valPreds = validation.map((r) => ({ p: predictProba(model, r.vector), y: r.label }));
    const thresholds = selectThresholds(valPreds);
    const testPreds = test.map((r) => ({ p: predictProba(model, r.vector), y: r.label }));
    const ml = evaluate(testPreds, 0.5);

    const detP = { high: 0.92, medium: 0.75, low: 0.5, unknown: 0.4 };
    const rulePreds = test.map((r) => ({ p: detP[normEngineConf(r)] ?? 0.4, y: r.label }));
    const comparison = compareRuleVsMl({ rulePreds, mlPreds: testPreds });

    return {
      available: true,
      model: model.version,
      samples: { train: train.length, validation: validation.length, test: test.length, scorable: ds.scorable },
      sources: ds.sources,
      thresholds: { high: thresholds.high, medium: thresholds.medium, rationale: thresholds.rationale, source: thresholds.source },
      metrics: ml,
      comparison,
      note: 'Evaluation only. This does not deploy a model or change any verdict. Deploy via: npm run train:calibration <dataset.json> --deploy after review.',
    };
  }
}

function normEngineConf(record) {
  // The dataset records carry the engine verdict but not its confidence label;
  // approximate the engine's confidence from the durable features so the rule
  // baseline is fair. Confirmed/rejected -> high; catch-all -> medium; else low.
  const f = record.features || {};
  if (f.smtp_accept || f.smtp_reject || f.disposable || f.undeliverable_verdict) return 'high';
  if (f.catch_all) return 'medium';
  return 'low';
}

// ---- Model Drift Report ---------------------------------------------------
// Advisory only. Compares a baseline window vs a recent window and recommends
// retraining if drift is detected. Never retrains or swaps a model.
export class GetCalibrationDrift {
  execute(_userId, { baseline, recent, thresholds } = {}) {
    return detectDrift({ baseline, recent, thresholds });
  }
}

function pubList(l) {
  return l ? { id: l.id, name: l.name, total: l.total, status: l.status } : null;
}
function pubCapability(c) {
  return c ? { liveSmtp: c.liveSmtp, smtpMode: c.smtpMode, smtpSource: c.smtpSource, provider: c.provider } : null;
}
