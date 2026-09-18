// Orchestrates the single-verification experience: form + result, in the
// required information hierarchy (email → verdict → explanation → confidence →
// pipeline → evidence → recommendation → technical details).
//
// Owns no data logic itself — it uses the useSingleVerification hook. Credits
// stay in sync via the onUser callback (updates the auth user), preserving the
// original SingleCheckView behavior.
import { useAuth } from '../../../auth';
import { PageHeader } from '../../../components/ui';
import { useSingleVerification } from '../hooks/useSingleVerification';
import { deriveStages } from '../types';
import { EmailVerificationForm } from './EmailVerificationForm';
import { VerificationVerdict } from './VerificationVerdict';
import { ConfidenceIndicator } from './ConfidenceIndicator';
import { VerificationPipeline } from './VerificationPipeline';
import { VerificationEvidence } from './VerificationEvidence';
import { VerificationRecommendation } from './VerificationRecommendation';

export function SingleVerificationPanel() {
  const { setUser } = useAuth();
  const { email, setEmail, busy, result, validationError, requestError, run, reset } =
    useSingleVerification(setUser);

  return (
    <>
      <PageHeader
        title="Single Email Check"
        subtitle="Verify one address and see exactly what MailHealth observed. Costs 1 credit."
      />

      <div className="verify-layout">
        <div className="verify-panel card">
          <EmailVerificationForm
            email={email}
            onEmailChange={setEmail}
            onRun={run}
            busy={busy}
            validationError={validationError}
          />

          {/* API / network failure — distinct from a verification UNKNOWN result. */}
          {requestError && (
            <p className="verify-request-error error" role="alert">
              {requestError}
            </p>
          )}

          {/* Loading: honest, non-progressing (single verification is not streamed). */}
          {busy && (
            <p className="verify-loading muted" aria-live="polite">
              MailHealth is checking this address…
            </p>
          )}
        </div>

        {result && !busy && (
          <div className="verify-result">
            <VerificationVerdict result={result} />

            <div className="verify-result-grid">
              <ConfidenceIndicator result={result} />
              <VerificationRecommendation result={result} />
            </div>

            <VerificationPipeline stages={deriveStages(result)} />
            <VerificationEvidence result={result} />

            <button type="button" className="btn ghost sm verify-again" onClick={reset}>
              Verify another address
            </button>
          </div>
        )}
      </div>
    </>
  );
}
