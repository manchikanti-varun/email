// A single pipeline stage row. Communicates its state with an icon + text label
// (never color alone), so UNKNOWN and NOT_CHECKED read as distinct from FAILED.
import type { PipelineStage, StageState } from '../types';

const STATE_META: Record<StageState, { icon: string; word: string; cls: string }> = {
  success: { icon: '✓', word: 'Passed', cls: 'stage-success' },
  failed: { icon: '✕', word: 'Failed', cls: 'stage-failed' },
  unknown: { icon: '?', word: 'Unknown', cls: 'stage-unknown' },
  not_checked: { icon: '–', word: 'Not checked', cls: 'stage-skipped' },
};

export function VerificationStage({ stage }: { stage: PipelineStage }) {
  const meta = STATE_META[stage.state];
  return (
    <li className={`vstage ${meta.cls}`}>
      <span className="vstage-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="vstage-body">
        <span className="vstage-name">{stage.label}</span>
        <span className="vstage-detail">{stage.detail || meta.word}</span>
      </span>
      {/* Text state for screen readers / no-color communication. */}
      <span className="vstage-state">{meta.word}</span>
    </li>
  );
}
