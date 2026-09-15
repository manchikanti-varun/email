// ML Confidence Calibration — Model artifact loader.
//
// Loads a serialized model JSON from disk. Any failure (missing / unreadable /
// invalid JSON / wrong shape) returns null so the calibrator falls back to
// deterministic confidence. Loading NEVER throws to the caller.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUsable, MODEL_VERSION } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default location of the shipped/active model artifact.
export const DEFAULT_MODEL_PATH = path.join(__dirname, 'models', `${MODEL_VERSION}.json`);

/**
 * Load a model artifact. Returns the parsed model object, or null on any
 * problem. A model with { trained:false } is returned as-is so the calibrator
 * can surface an accurate UNAVAILABLE reason.
 */
export function loadModel(modelPath = DEFAULT_MODEL_PATH) {
  try {
    if (!fs.existsSync(modelPath)) return null;
    const raw = fs.readFileSync(modelPath, 'utf8');
    const model = JSON.parse(raw);
    // Untrained placeholder is a valid, honest state.
    if (model && model.trained === false) return model;
    // Otherwise it must be structurally usable, else treat as corrupted.
    if (!isUsable(model)) return { version: model?.version || MODEL_VERSION, trained: false, reason: 'corrupted' };
    return model;
  } catch {
    return { version: MODEL_VERSION, trained: false, reason: 'corrupted' };
  }
}

export function saveModel(model, modelPath = DEFAULT_MODEL_PATH) {
  const dir = path.dirname(modelPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(modelPath, JSON.stringify(model, null, 2));
  return modelPath;
}
