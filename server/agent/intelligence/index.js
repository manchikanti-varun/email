// Barrel for the AI Intelligence Layer. These are PURE analysis modules: they
// receive deterministic data and return interpretation (FACT / INFERENCE /
// PREDICTION / RECOMMENDATION + confidence). They never fetch data, never call
// an LLM, never mutate verification verdicts.
//
// Data-fetching and orchestration live in the application layer
// (server/src/application/ai-use-cases.js), which reuses existing repositories
// and use cases.

export * from './common.js';
export { listStatistics, domainStatistics, snapshotDelta } from './statistics.js';
export { campaignRisk, listHealthAnalysis, healthPrediction } from './health-modules.js';
export { detectAnomalies, detectIncident, domainIntelligence } from './detection-modules.js';
export { smartCleaning, prioritizeReverification, optimizeCredits, explainEmail } from './operations-modules.js';
export { businessInsights, analyzeBenchmark, investigate } from './insight-modules.js';
