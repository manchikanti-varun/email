// Confidence in the verdict. Secondary to the verdict itself — rendered small
// and neutral so it never reads as a second verdict. Prefers the calibrated
// (ML or rule-based) panel when calibration data exists; otherwise shows the
// engine's own confidence word.
import type { VerifyResult } from '../../../types';
import { ConfidencePanel } from '../../../components/domain';

export function ConfidenceIndicator({ result }: { result: VerifyResult }) {
  // ConfidencePanel already handles ML vs rule-based labeling honestly and
  // falls back to the deterministic confidence when no model is deployed.
  return <ConfidencePanel cal={result.confidenceCalibration} confidence={result.confidence} />;
}
