// HTTP surface for the AI Intelligence Layer. Thin controllers only: they map
// request -> AI use-case -> JSON. All routes are auth-guarded and act as the
// current user; ownership is enforced inside the use-cases (via GetListDetail).
// No business logic, no SQL here. These endpoints reuse the SAME authentication
// as the rest of the API — there is no second auth mechanism.
import express from 'express';
import { asyncHandler } from '../middleware.js';

export function makeAiRouter(deps) {
  const {
    authRequired,
    aiCampaignRisk, aiHealthAnalysis, aiHealthPrediction, aiListAnomalies,
    aiDomainIntelligence, aiSmartCleaning, aiReverificationPriority,
    aiCreditOptimization, aiEmailExplanation, aiBusinessInsights,
    aiInvestigate, aiIncidents, aiBenchmarkAnalysis,
    aiConfidenceCalibration, aiCalibrationBenchmark, aiCalibrationDrift,
    analyzeListHealth, getLatestListAnalysis,
    calibrator,
  } = deps;

  const router = express.Router();
  const uid = (req) => req.user.id;

  // ---- AI List Health Analysis & Diagnosis -------------------------------

  // POST /api/ai/lists/:id/analyze  { useAi?: boolean }
  // Computes the deterministic health report + one fail-safe AI diagnosis.
  router.post('/lists/:id/analyze', authRequired, asyncHandler(async (req, res) => {
    const useAi = (req.body || {}).useAi !== false; // default true; AI still fails safe
    res.json(await analyzeListHealth.execute(uid(req), req.params.id, { useAi }));
  }));

  // GET /api/ai/lists/:id/analysis — latest persisted analysis (no LLM call).
  router.get('/lists/:id/analysis', authRequired, asyncHandler((req, res) => {
    res.json(getLatestListAnalysis.execute(uid(req), req.params.id));
  }));

  // POST /api/ai/campaign-risk  { listId }
  router.post('/campaign-risk', authRequired, asyncHandler((req, res) => {
    res.json(aiCampaignRisk.execute(uid(req), (req.body || {}).listId));
  }));

  // GET /api/ai/lists/:id/health-analysis
  router.get('/lists/:id/health-analysis', authRequired, asyncHandler((req, res) => {
    res.json(aiHealthAnalysis.execute(uid(req), req.params.id));
  }));

  // GET /api/ai/lists/:id/health-prediction
  router.get('/lists/:id/health-prediction', authRequired, asyncHandler((req, res) => {
    res.json(aiHealthPrediction.execute(uid(req), req.params.id));
  }));

  // GET /api/ai/lists/:id/anomalies
  router.get('/lists/:id/anomalies', authRequired, asyncHandler((req, res) => {
    res.json(aiListAnomalies.execute(uid(req), req.params.id));
  }));

  // GET /api/ai/lists/:id/domains?limit=&minContacts=
  router.get('/lists/:id/domains', authRequired, asyncHandler((req, res) => {
    const limit = clampInt(req.query.limit, 1, 50, 10);
    const minContacts = clampInt(req.query.minContacts, 1, 1e9, 1);
    res.json(aiDomainIntelligence.execute(uid(req), req.params.id, { limit, minContacts }));
  }));

  // GET /api/ai/lists/:id/cleaning
  router.get('/lists/:id/cleaning', authRequired, asyncHandler((req, res) => {
    res.json(aiSmartCleaning.execute(uid(req), req.params.id));
  }));

  // GET /api/ai/lists/:id/reverification-priority?limit=
  router.get('/lists/:id/reverification-priority', authRequired, asyncHandler((req, res) => {
    const limit = clampInt(req.query.limit, 1, 500, 100);
    res.json(aiReverificationPriority.execute(uid(req), req.params.id, { limit }));
  }));

  // GET /api/ai/lists/:id/business-insights
  router.get('/lists/:id/business-insights', authRequired, asyncHandler((req, res) => {
    res.json(aiBusinessInsights.execute(uid(req), req.params.id));
  }));

  // GET /api/ai/lists/:id/contacts/:email/explanation?mode=simple|technical
  router.get('/lists/:id/contacts/:email/explanation', authRequired, asyncHandler((req, res) => {
    const mode = req.query.mode === 'technical' ? 'technical' : 'simple';
    const email = decodeURIComponent(req.params.email);
    res.json(aiEmailExplanation.execute(uid(req), req.params.id, { email, mode }));
  }));

  // GET /api/ai/credits/optimization?listId=
  router.get('/credits/optimization', authRequired, asyncHandler((req, res) => {
    res.json(aiCreditOptimization.execute(uid(req), req.query.listId));
  }));

  // GET /api/ai/incidents?listId=   (listId optional -> account-wide scan)
  router.get('/incidents', authRequired, asyncHandler((req, res) => {
    res.json(aiIncidents.execute(uid(req), req.query.listId || null));
  }));

  // POST /api/ai/investigate  { listId, question? }
  router.post('/investigate', authRequired, asyncHandler((req, res) => {
    const { listId, question } = req.body || {};
    res.json(aiInvestigate.execute(uid(req), listId, { question }));
  }));

  // POST /api/ai/benchmark-analysis  { benchmark }
  router.post('/benchmark-analysis', authRequired, asyncHandler((req, res) => {
    res.json(aiBenchmarkAnalysis.execute(uid(req), { benchmark: (req.body || {}).benchmark }));
  }));

  // ---- ML Confidence Calibration -----------------------------------------

  // GET /api/ai/calibration/status  — model availability + version.
  router.get('/calibration/status', authRequired, asyncHandler((_req, res) => {
    res.json(calibrator ? calibrator.status() : { available: false, reason: 'no-model' });
  }));

  // GET /api/ai/lists/:id/contacts/:email/confidence
  // Calibrated reliability for one contact in an owned list. Verdict unchanged.
  router.get('/lists/:id/contacts/:email/confidence', authRequired, asyncHandler((req, res) => {
    const email = decodeURIComponent(req.params.email);
    res.json(aiConfidenceCalibration.execute(uid(req), req.params.id, { email }));
  }));

  // Convenience alias closer to the task's suggested shape:
  // GET /api/ai/contacts/:id/confidence?listId=&email=
  router.get('/contacts/:id/confidence', authRequired, asyncHandler((req, res) => {
    const listId = req.query.listId;
    const email = req.query.email ? decodeURIComponent(req.query.email) : undefined;
    res.json(aiConfidenceCalibration.execute(uid(req), listId, { contactId: req.params.id, email }));
  }));

  // POST /api/ai/calibration/benchmark  { dataset }
  // Benchmark dashboard: rule engine vs rule+ML. Evaluation only; no deploy.
  router.post('/calibration/benchmark', authRequired, asyncHandler((req, res) => {
    res.json(aiCalibrationBenchmark.execute(uid(req), { dataset: (req.body || {}).dataset }));
  }));

  // POST /api/ai/calibration/drift  { baseline, recent, thresholds? }
  router.post('/calibration/drift', authRequired, asyncHandler((req, res) => {
    const { baseline, recent, thresholds } = req.body || {};
    res.json(aiCalibrationDrift.execute(uid(req), { baseline, recent, thresholds }));
  }));

  return router;
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
