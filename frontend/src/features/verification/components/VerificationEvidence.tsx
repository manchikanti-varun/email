// Evidence + technical details.
//
// Shows the risk signals and a collapsible "technical details" block sourced
// entirely from the backend response (SMTP source, final reason, SMTP evidence
// trail: mxHost / code / response / catch-all / worker). Nothing is fabricated;
// fields that are absent are simply not shown.
import type { VerifyResult } from '../../../types';
import { RiskChips } from '../../../components/domain';

interface VantageRow {
  vantage?: string;
  source?: string | null;
  mxHost?: string | null;
  code?: number | null;
  smtpClass?: string | null;
  error?: string | null;
  responseTimeMs?: number | null;
}

export function VerificationEvidence({ result }: { result: VerifyResult }) {
  const smtp = result.smtpEvidence;
  const vantages = (smtp?.vantages as VantageRow[] | undefined) || [];
  const hasTechnical =
    !!result.smtpSource ||
    !!result.finalReason ||
    !!smtp?.worker?.id ||
    vantages.length > 0;

  return (
    <section className="vevidence" aria-label="Evidence">
      <div className="vsection-title">Risk signals</div>
      <div className="vevidence-risks">
        <RiskChips riskSignals={result.riskSignals} />
      </div>

      {hasTechnical && (
        <details className="vtech">
          <summary>Technical details</summary>
          <dl className="vtech-grid">
            {result.smtpSource && (
              <>
                <dt>SMTP source</dt>
                <dd>{result.smtpSource}</dd>
              </>
            )}
            {result.finalReason && (
              <>
                <dt>Final reason</dt>
                <dd>{result.finalReason.replace(/_/g, ' ')}</dd>
              </>
            )}
            {smtp?.worker?.id && (
              <>
                <dt>Worker</dt>
                <dd>{smtp.worker.id}</dd>
              </>
            )}
            {typeof smtp?.retries === 'number' && (
              <>
                <dt>Retries</dt>
                <dd>{smtp.retries}</dd>
              </>
            )}
          </dl>

          {vantages.length > 0 && (
            <table className="vtech-table">
              <thead>
                <tr>
                  <th>Vantage</th>
                  <th>MX host</th>
                  <th>Code</th>
                  <th>Class</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {vantages.map((v, i) => (
                  <tr key={i}>
                    <td>{v.vantage || v.source || '—'}</td>
                    <td>{v.mxHost || '—'}</td>
                    <td>{v.code ?? '—'}</td>
                    <td>{v.smtpClass || v.error || '—'}</td>
                    <td>{v.responseTimeMs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}
    </section>
  );
}
