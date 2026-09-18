// Verification feature view-model types + the pure mapping from the backend's
// ordered `evidence[]` array to a conceptual verification pipeline.
//
// IMPORTANT: this NEVER computes a verdict or fabricates a stage result. It only
// classifies the evidence the backend already returned. A conceptual stage with
// no matching backend evidence is reported as NOT_CHECKED — never a fake pass.
import type { Signal, VerifyResult } from '../../types';

// State of a single pipeline stage, derived strictly from backend evidence.
export type StageState = 'success' | 'failed' | 'unknown' | 'not_checked';

export interface PipelineStage {
  key: string;
  label: string;
  state: StageState;
  // The exact backend evidence label(s) that produced this state, verbatim.
  detail?: string;
}

// Conceptual pipeline order shown in the UI. Each stage is matched against the
// backend evidence labels; unmatched stages render as NOT_CHECKED. Catch-all is
// handled separately (see deriveStages) using the authoritative mailboxStatus /
// acceptanceType fields rather than string-matching, so it is never mislabeled.
const STAGE_DEFS: { key: string; label: string; match: RegExp }[] = [
  { key: 'syntax', label: 'Syntax', match: /syntax/i },
  { key: 'domain', label: 'Domain', match: /domain (exists|does not exist)|reserved|documentation domain/i },
  { key: 'mx', label: 'MX records', match: /\bMX\b|mail server/i },
  { key: 'disposable', label: 'Disposable', match: /disposable/i },
  { key: 'role', label: 'Role', match: /role-based|individual \(not role/i },
  { key: 'smtp', label: 'SMTP', match: /smtp|mailbox|mail servers? (did not|completed)|handshake/i },
];

// Map a single evidence signal's status → a stage state, using its label to
// distinguish UNKNOWN (unconfirmed / not performed) from a real FAILED.
function stateForSignal(sig: Signal): StageState {
  switch (sig.status) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'failed';
    case 'warn':
      // Warnings (greylisting, implicit-MX, possible typo) are cautionary,
      // not failures → surfaced as UNKNOWN/uncertain.
      return 'unknown';
    case 'info':
    default:
      // Info signals are informational. "not performed"/"disabled" means the
      // check did not run; everything else here is an unconfirmed observation.
      if (/not performed|disabled/i.test(sig.label)) return 'not_checked';
      return 'unknown';
  }
}

// Derive the conceptual pipeline from the backend evidence array. Stages with
// no matching evidence are NOT_CHECKED. Where multiple signals match a stage,
// the most decisive one wins (failed > success > unknown > not_checked) so the
// stage reflects the strongest real observation without inventing anything.
export function deriveStages(result: VerifyResult): PipelineStage[] {
  const evidence: Signal[] = (result.signals || []) as Signal[];

  const rank: Record<StageState, number> = { failed: 3, success: 2, unknown: 1, not_checked: 0 };

  const stages: PipelineStage[] = STAGE_DEFS.map((def) => {
    const matches = evidence.filter((e) => def.match.test(e.label));
    if (matches.length === 0) {
      return { key: def.key, label: def.label, state: 'not_checked' as StageState };
    }
    let best: Signal = matches[0];
    let bestState: StageState = stateForSignal(best);
    for (const sig of matches) {
      const s = stateForSignal(sig);
      if (rank[s] > rank[bestState]) {
        best = sig;
        bestState = s;
      }
    }
    return { key: def.key, label: def.label, state: bestState, detail: best.label };
  });

  // Catch-all is a DOMAIN property and positive mail-infrastructure evidence,
  // not a failure. Derive it from the authoritative backend fields, not text.
  const catchAllDetected =
    result.mailboxStatus === 'ACCEPT_ALL' || result.acceptanceType === 'CATCH_ALL';
  const catchAllEvidence = evidence.find((e) => /catch-all/i.test(e.label));
  const catchAllStage: PipelineStage = catchAllEvidence
    ? {
        key: 'catchall',
        label: 'Catch-all',
        // Detected catch-all is a real, positive observation → success (accepted),
        // not a red failure. If SMTP could not run, it's simply not_checked.
        state: catchAllDetected ? 'success' : 'unknown',
        detail: catchAllEvidence.label,
      }
    : { key: 'catchall', label: 'Catch-all', state: catchAllDetected ? 'success' : 'not_checked' };

  stages.push(catchAllStage);
  return stages;
}

// ---- Bulk verification workflow ----------------------------------------
// The bulk flow reuses the shared UploadResult / UploadProgressEvent types
// (see ../../types). This local alias documents the workflow's phases without
// duplicating those contracts.
export type BulkPhase = 'idle' | 'uploading' | 'parsing' | 'saving' | 'ready' | 'error';
