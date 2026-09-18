// The verification pipeline: a vertical, mobile-friendly list of stages derived
// strictly from the backend evidence. No stage is animated or faked — this is a
// static representation of what the backend actually reported for this address.
import type { PipelineStage } from '../types';
import { VerificationStage } from './VerificationStage';

export function VerificationPipeline({ stages }: { stages: PipelineStage[] }) {
  return (
    <section className="vpipeline" aria-label="Verification checks">
      <h3 className="vsection-title">Verification pipeline</h3>
      <ol className="vpipeline-list">
        {stages.map((s) => (
          <VerificationStage key={s.key} stage={s} />
        ))}
      </ol>
    </section>
  );
}
