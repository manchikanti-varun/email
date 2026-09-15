// ML Confidence Calibration — Model.
//
// A LIGHTWEIGHT, INTERPRETABLE, REPRODUCIBLE model implemented in pure JS with
// ZERO runtime dependencies (suitable for fast backend inference). It is a
// binary logistic-regression classifier that estimates:
//
//     P(deterministic verdict is CORRECT | evidence features)
//
// Deliberately NOT deep learning: logistic regression is explainable (per-
// feature weights == importance), fast, and reproducible given a fixed seed.
// If a richer model is ever needed it can be swapped behind the same interface.
//
// The model NEVER produces a verdict. It only produces a reliability
// probability that a downstream mapping turns into HIGH/MEDIUM/LOW.

import { FEATURE_NAMES } from './features.js';

export const MODEL_VERSION = 'confidence-v1';
export const MODEL_KIND = 'logistic-regression';

// Deterministic PRNG (mulberry32) for reproducible weight init / shuffling.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(z) {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z);
  return e / (1 + e);
}

// Compute per-feature mean/std for standardization (std=1 when degenerate).
function standardizer(rows) {
  const d = FEATURE_NAMES.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  const n = rows.length || 1;
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r.vector[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of rows) for (let j = 0; j < d; j++) { const dv = r.vector[j] - mean[j]; std[j] += dv * dv; }
  for (let j = 0; j < d; j++) { std[j] = Math.sqrt(std[j] / n) || 1; }
  return { mean, std };
}

function standardize(vec, mean, std) {
  return vec.map((x, j) => (x - mean[j]) / std[j]);
}

/**
 * Train a logistic-regression calibrator with batch gradient descent + L2.
 *
 * @param {Array} train  records with .vector (number[]) and .label (0|1)
 * @param {object} [opts]
 * @returns {object} serializable model
 */
export function trainModel(train, opts = {}) {
  const rows = (train || []).filter((r) => r && Array.isArray(r.vector) && (r.label === 0 || r.label === 1));
  const minSamples = opts.minSamples ?? 20;
  if (rows.length < minSamples) {
    return {
      version: MODEL_VERSION,
      kind: MODEL_KIND,
      trained: false,
      reason: 'insufficient-data',
      samples: rows.length,
      minSamples,
    };
  }

  const d = FEATURE_NAMES.length;
  const { mean, std } = standardizer(rows);
  const X = rows.map((r) => standardize(r.vector, mean, std));
  const y = rows.map((r) => r.label);

  const lr = opts.learningRate ?? 0.1;
  const l2 = opts.l2 ?? 0.001;
  const epochs = opts.epochs ?? 400;
  const seed = opts.seed ?? 42;
  const rand = mulberry32(seed);

  let w = new Array(d).fill(0).map(() => (rand() - 0.5) * 0.01);
  let b = 0;
  const n = X.length;

  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = dot(w, X[i]) + b;
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) {
      gw[j] = gw[j] / n + l2 * w[j];
      w[j] -= lr * gw[j];
    }
    b -= lr * (gb / n);
  }

  // Positive-class base rate — used as the neutral fallback probability.
  const baseRate = y.reduce((a, v) => a + v, 0) / n;

  return {
    version: MODEL_VERSION,
    kind: MODEL_KIND,
    trained: true,
    createdAt: new Date().toISOString(),
    featureNames: FEATURE_NAMES.slice(),
    standardizer: { mean, std },
    weights: w,
    bias: b,
    baseRate: round4(baseRate),
    samples: n,
    hyperparams: { learningRate: lr, l2, epochs, seed, minSamples },
  };
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function round4(n) { return Math.round(n * 1e4) / 1e4; }

/**
 * Predict P(correct) for a single feature vector. Returns a number in [0,1].
 * Throws if the model is not trained/usable — callers should guard via
 * isUsable() and fall back to deterministic confidence instead.
 */
export function predictProba(model, vector) {
  if (!isUsable(model)) throw new Error('model-not-usable');
  if (!Array.isArray(vector) || vector.length !== model.weights.length) {
    throw new Error('feature-shape-mismatch');
  }
  const { mean, std } = model.standardizer;
  const x = vector.map((v, j) => (v - mean[j]) / std[j]);
  return sigmoid(dot(model.weights, x) + model.bias);
}

export function isUsable(model) {
  return !!(model && model.trained && Array.isArray(model.weights) &&
    model.standardizer && Array.isArray(model.standardizer.mean) &&
    Array.isArray(model.featureNames) &&
    model.featureNames.length === model.weights.length);
}

// Feature importance = standardized-weight magnitude (comparable across
// features because inputs are standardized). Returns sorted [{feature,weight,importance}].
export function featureImportance(model) {
  if (!isUsable(model)) return [];
  return model.weights
    .map((w, j) => ({ feature: model.featureNames[j], weight: round4(w), importance: round4(Math.abs(w)) }))
    .sort((a, b) => b.importance - a.importance);
}

// Per-prediction contributions (standardized weight * standardized value), so a
// single result can be explained. Returns top-N by absolute contribution.
export function explainPrediction(model, vector, topN = 5) {
  if (!isUsable(model)) return [];
  const { mean, std } = model.standardizer;
  const contribs = model.weights.map((w, j) => {
    const xj = (vector[j] - mean[j]) / std[j];
    return { feature: model.featureNames[j], contribution: round4(w * xj), value: vector[j] };
  });
  return contribs
    .filter((c) => Math.abs(c.contribution) > 1e-6)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, topN);
}
