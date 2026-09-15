// Barrel for the ML Confidence Calibration layer.
//
// This layer sits DOWNSTREAM of the deterministic verification engine. It reads
// the engine's real evidence and estimates how RELIABLE the engine's verdict
// is — it never invents evidence and never changes a verdict.
//
//   Deterministic Engine → Rule Verdict → [ ML Calibration ] → Calibrated Result
//
// Responsibilities strictly limited to: confidence calibration, reliability
// estimation, disagreement detection, drift detection, benchmark evaluation.

export { FEATURE_NAMES, extractFeatures, evidenceBullets, toDeliverability, providerAgreement } from './features.js';
export { buildDataset, splitDataset, toBenchmarkResults, GROUND_TRUTH_SOURCE } from './dataset.js';
export { trainModel, predictProba, isUsable, featureImportance, explainPrediction, MODEL_VERSION, MODEL_KIND } from './model.js';
export { evaluate, reliabilityCurve, compareRuleVsMl } from './metrics.js';
export { toLevel, selectThresholds, DEFAULT_THRESHOLDS, LEVEL } from './mapping.js';
export { detectDisagreement } from './disagreement.js';
export { detectDrift } from './drift.js';
export { ConfidenceCalibrator } from './calibrator.js';
export { loadModel, saveModel, DEFAULT_MODEL_PATH } from './loader.js';
