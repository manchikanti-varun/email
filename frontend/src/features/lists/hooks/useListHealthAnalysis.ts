// State + behavior for the AI List Health analysis of a single list.
//
// On mount it loads any persisted analysis (no LLM call). The user can then
// run a fresh analysis (one list-level backend call; AI is fail-safe on the
// server — if the LLM is unavailable the backend returns the deterministic
// diagnosis, and this hook renders it identically).
import { useCallback, useEffect, useState } from 'react';
import type { ListHealthAnalysis } from '../../../types';
import { listsApi } from '../services/lists-api';

export interface UseListHealthAnalysis {
  loading: boolean;
  running: boolean;
  analysis: ListHealthAnalysis | null;
  error: string;
  /** True once we know whether a stored analysis exists. */
  ready: boolean;
  run: () => Promise<void>;
}

// Adapts the persisted "latest" shape into the full analysis shape the UI uses.
function fromLatest(id: string, latest: Awaited<ReturnType<typeof listsApi.latestAnalysis>>): ListHealthAnalysis | null {
  if (!latest.available || !latest.report) return null;
  return {
    list: { id, name: '', total: latest.report.metrics?.total ?? 0, status: '' },
    generatedAt: latest.createdAt || '',
    healthScore: latest.healthScore ?? latest.report.healthScore,
    healthLevel: latest.healthLevel ?? latest.report.healthLevel,
    scoreModel: latest.report.scoreModel,
    metrics: latest.report.metrics,
    providers: latest.report.providers,
    domains: latest.report.domains,
    riskSignals: latest.report.riskSignals,
    recommendations: latest.report.recommendations,
    diagnosis: latest.diagnosis || { summary: '', keyIssues: [], recommendations: [], observations: [] },
    diagnosisMeta: {
      source: latest.diagnosisSource || 'deterministic',
      model: latest.diagnosisSource === 'ai' ? 'ai' : 'deterministic',
      latencyMs: 0,
      estimatedCost: 0,
    },
  };
}

export function useListHealthAnalysis(id: string): UseListHealthAnalysis {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [analysis, setAnalysis] = useState<ListHealthAnalysis | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  // Load any persisted analysis on mount / id change. State is set only after
  // the awaited fetch resolves (never synchronously in the effect), so the
  // set-state-in-effect guard does not apply here.
  useEffect(() => {
    let cancelled = false;
    listsApi
      .latestAnalysis(id)
      .then((latest) => {
        if (cancelled) return;
        setAnalysis(fromLatest(id, latest));
      })
      .catch(() => {
        /* no stored analysis; leave null */
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const run = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      const result = await listsApi.analyze(id);
      setAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Please try again.');
    } finally {
      setRunning(false);
    }
  }, [id]);

  return { loading, running, analysis, error, ready, run };
}
