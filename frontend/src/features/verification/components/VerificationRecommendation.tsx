// Recommended action + full reasoning, straight from the backend. The action
// badge reuses the shared domain component so KEEP/REVIEW/REVERIFY/REMOVE look
// consistent with the rest of the product. No recommendation logic here.
import type { VerifyResult } from '../../../types';
import { ActionBadge } from '../../../components/domain';

export function VerificationRecommendation({ result }: { result: VerifyResult }) {
  const reasons = result.reasons || [];
  return (
    <section className="vreco" aria-label="Recommended action">
      <div className="vreco-head">
        <span className="vsection-title">Recommended action</span>
        <ActionBadge action={result.recommendedAction || result.classification} />
      </div>
      {result.recommendation && <p className="vreco-text">{result.recommendation}</p>}
      {reasons.length > 0 && (
        <div className="vreco-why">
          <div className="vsection-title">Why this result?</div>
          <ul className="vreco-list">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
