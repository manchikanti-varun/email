// AI List Health Analysis — application use cases.
//
// Orchestrates: fetch deterministic data (ownership-checked via GetListDetail),
// compute the deterministic health report + score, run ONE list-level AI
// diagnosis (fail-safe), validate it, persist, and return a combined analysis.
//
// Invariants:
//   - The AI is an ENHANCEMENT. If it is disabled/unavailable/times out/returns
//     invalid JSON, we return the deterministic fallback diagnosis instead —
//     the analysis never fails because of the AI.
//   - The AI NEVER verifies, decides deliverability, or overrides a verdict.
//   - Exactly ONE LLM call per list analysis (never per-email).
//   - Data minimization: only aggregates + masked examples reach the model.
import { AppError } from './errors.js';
import { agentLogger } from '../../agent/logger.js';
import {
  buildListHealth,
  buildDiagnosisInput, validateDiagnosis, fallbackDiagnosis, diagnosisMeta,
  DIAGNOSIS_SYSTEM_PROMPT,
} from '../../agent/intelligence/index.js';

export class AnalyzeListHealth {
  /**
   * @param {object} deps
   * @param {object} deps.getListDetail  ownership-checked list loader (use case)
   * @param {import('../../agent/provider.js').AiProvider} [deps.aiProvider]
   * @param {object} [deps.analysisRepository] SqliteListAnalysisRepository (optional persistence)
   */
  constructor({ getListDetail, aiProvider = null, analysisRepository = null }) {
    this.getListDetail = getListDetail;
    this.ai = aiProvider;
    this.repo = analysisRepository;
  }

  /**
   * @param {string} userId
   * @param {string} listId
   * @param {{ useAi?: boolean }} [opts] useAi=false forces the deterministic-only path
   */
  async execute(userId, listId, { useAi = true } = {}) {
    if (!listId || typeof listId !== 'string') throw new AppError(400, 'A valid listId is required');
    const started = Date.now();
    // GetListDetail enforces ownership (throws 404 if the list is not the user's).
    const detail = this.getListDetail.execute(userId, listId);
    const { list, summary, contacts } = detail;

    agentLogger.info('list_analysis_started', { userId, listId, contacts: contacts?.length ?? 0 });

    // 1) Deterministic report (source of truth; never AI-computed).
    const report = buildListHealth({ contacts, summary });

    // 2) One list-level AI diagnosis (fail-safe). Falls back deterministically.
    let diagnosis;
    let meta;
    const canUseAi = useAi && this.ai && this.ai.isEnabled?.() && this.ai.hasModel?.();
    if (canUseAi) {
      const input = buildDiagnosisInput({ report, contacts, list });
      try {
        agentLogger.info('list_analysis_ai_requested', { userId, listId, model: true });
        const res = await this.ai.completeJson({
          system: DIAGNOSIS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        });
        const validated = res.ok ? validateDiagnosis(res.json) : null;
        if (validated) {
          diagnosis = validated;
          meta = diagnosisMeta({ source: 'ai', model: res.model, latencyMs: res.latencyMs, estimatedCost: res.estimatedCost });
        } else {
          diagnosis = fallbackDiagnosis(report);
          meta = diagnosisMeta({ source: 'deterministic', latencyMs: res.latencyMs || 0, error: res.error || 'invalid_ai_response' });
          agentLogger.warn('list_analysis_ai_failed', { userId, listId, error: res.error || 'invalid_ai_response' });
        }
      } catch (e) {
        // AI failure MUST NOT fail the analysis.
        diagnosis = fallbackDiagnosis(report);
        meta = diagnosisMeta({ source: 'deterministic', error: e.message || 'ai_error' });
        agentLogger.warn('list_analysis_ai_failed', { userId, listId, error: e.message || 'ai_error' });
      }
    } else {
      diagnosis = fallbackDiagnosis(report);
      meta = diagnosisMeta({ source: 'deterministic' });
    }

    // 3) Persist the latest analysis (best-effort; never blocks the response).
    if (this.repo) {
      try {
        this.repo.save({
          listId, userId,
          healthScore: report.healthScore,
          healthLevel: report.healthLevel,
          report,
          diagnosis,
          diagnosisSource: meta.source,
        });
      } catch (e) {
        agentLogger.warn('list_analysis_persist_failed', { userId, listId, error: e.message });
      }
    }

    const durationMs = Date.now() - started;
    agentLogger.info('list_analysis_completed', { userId, listId, healthScore: report.healthScore, source: meta.source, durationMs });

    return {
      list: pubList(list),
      generatedAt: report.generatedAt,
      healthScore: report.healthScore,
      healthLevel: report.healthLevel,
      scoreModel: report.scoreModel,
      metrics: report.metrics,
      providers: report.providers,
      domains: report.domains,
      riskSignals: report.riskSignals,
      recommendations: report.recommendations,
      diagnosis,
      diagnosisMeta: meta,
    };
  }
}

// Returns the persisted latest analysis for an owned list, or a "not analyzed
// yet" marker. Ownership is enforced by the repository's user_id filter AND by
// GetListDetail (used to confirm the list exists for this user).
export class GetLatestListAnalysis {
  constructor({ getListDetail, analysisRepository }) {
    this.getListDetail = getListDetail;
    this.repo = analysisRepository;
  }
  execute(userId, listId) {
    if (!listId || typeof listId !== 'string') throw new AppError(400, 'A valid listId is required');
    // Confirm ownership (throws 404 if not the user's list).
    this.getListDetail.execute(userId, listId);
    const latest = this.repo ? this.repo.findLatest(userId, listId) : null;
    if (!latest) return { available: false, message: 'This list has not been analyzed yet.' };
    return { available: true, ...latest };
  }
}

function pubList(l) {
  return l ? { id: l.id, name: l.name, total: l.total, status: l.status } : null;
}
