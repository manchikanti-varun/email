import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useNavigate } from '../lib/useHashRoute';
import { Modal } from '../components/Modal';
import type { AgentResponse, PendingConfirmation } from '../types';

const QUICK_ACTIONS = [
  'Analyze my latest list',
  'Is my list ready to send?',
  'Show risky contacts',
  'Why did my health change?',
  'Find contacts that need re-verification',
  'Clean this list',
];

const STEP_LABELS: Record<string, string> = {
  get_lists: 'Finding lists…',
  get_list: 'Loading list…',
  get_list_health: 'Checking health…',
  analyze_list: 'Analyzing list…',
  get_health_history: 'Checking health history…',
  get_contacts: 'Inspecting contacts…',
  get_risky_contacts: 'Inspecting risky contacts…',
  get_unknown_contacts: 'Inspecting unknown contacts…',
  get_remove_contacts: 'Inspecting remove contacts…',
  get_cleaning_plan: 'Building cleaning plan…',
  run_campaign_preflight: 'Running preflight…',
  get_reverify_cost: 'Estimating credit cost…',
  get_account_credits: 'Checking credits…',
  start_verification: 'Starting verification…',
  start_reverification: 'Starting re-verification…',
  delete_contacts: 'Removing contacts…',
  delete_list: 'Deleting list…',
  export_list: 'Preparing export…',
};

function stepClass(status: string): string {
  if (status === 'ok') return 'done';
  if (status === 'awaiting_confirmation') return 'wait';
  if (status && status.startsWith('error')) return 'fail';
  return 'done';
}

// Lightly structure the plain-text answer (verified facts / recommendation).
function AgentText({ text }: { text: string }) {
  const lines = (text || '').split('\n');
  return (
    <>
      {lines.map((line, i) => {
        let node: React.ReactNode = line;
        if (/^Verified facts:/i.test(line)) {
          node = (
            <>
              <b className="agent-verified">Verified facts:</b>
              {line.replace(/^Verified facts:/i, '')}
            </>
          );
        } else if (/^Recommendation:/i.test(line)) {
          node = (
            <>
              <b className="agent-reco">Recommendation:</b>
              {line.replace(/^Recommendation:/i, '')}
            </>
          );
        }
        return (
          <span key={i}>
            {node}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

interface Bubble {
  who: 'user' | 'ai';
  text?: string;
  error?: string;
  thinking?: boolean;
  response?: AgentResponse;
}

export function AgentView({ listId: paramListId }: { listId: string | null }) {
  const { refreshCredits } = useAuth();
  const navigate = useNavigate();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const session = useRef<{ conversationId?: string; listId?: string }>({
    listId: paramListId || undefined,
  });

  useEffect(() => {
    if (paramListId) session.current.listId = paramListId;
  }, [paramListId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [bubbles]);

  async function send(
    message: string,
    confirm?: { tool: string; args: Record<string, unknown>; token: string },
  ) {
    if ((!message && !confirm) || busy) return;
    setBusy(true);

    setBubbles((prev) => {
      const next = [...prev];
      if (message) next.push({ who: 'user', text: message });
      next.push({ who: 'ai', thinking: true });
      return next;
    });

    try {
      const res = await api.agentChat({
        message,
        listId: session.current.listId,
        conversationId: session.current.conversationId,
        confirm,
      });
      session.current.conversationId = res.conversationId || session.current.conversationId;
      setBubbles((prev) => {
        const next = prev.filter((b) => !b.thinking);
        next.push({ who: 'ai', response: res });
        return next;
      });
    } catch (e) {
      setBubbles((prev) => {
        const next = prev.filter((b) => !b.thinking);
        next.push({ who: 'ai', error: e instanceof Error ? e.message : 'Something went wrong' });
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function submit(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput('');
    send(msg);
  }

  function confirmPending() {
    if (!pending) return;
    const p = pending;
    setPending(null);
    send('', { tool: p.tool, args: p.args, token: p.token });
    refreshCredits();
  }

  return (
    <div className="agent-wrap">
      <div className="agent-head">
        <div className="agent-title">
          <span className="agent-glyph">🧠</span> MailHealth AI
        </div>
        <p className="agent-sub">
          Ask me about your email lists. I investigate your list health and can perform approved actions — I never
          guess verification results.
        </p>
      </div>

      <div className="agent-quick">
        {QUICK_ACTIONS.map((q) => (
          <button key={q} className="agent-chip" onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="agent-thread" ref={threadRef}>
        {bubbles.length === 0 && (
          <div className="agent-empty">
            <p>
              <b>Try:</b> "Is my customer list ready to send?" · "Why did my health drop?" · "Find risky contacts" ·
              "Clean my list"
            </p>
          </div>
        )}

        {bubbles.map((b, i) => {
          if (b.who === 'user') {
            return (
              <div key={i} className="agent-msg user">
                <div className="agent-body">
                  <div className="agent-text">{b.text}</div>
                </div>
              </div>
            );
          }
          // ai
          if (b.thinking) {
            return (
              <div key={i} className="agent-msg ai">
                <div className="agent-avatar">AI</div>
                <div className="agent-body">
                  <div className="agent-steps">
                    <span className="agent-step">Thinking…</span>
                  </div>
                </div>
              </div>
            );
          }
          if (b.error) {
            return (
              <div key={i} className="agent-msg ai">
                <div className="agent-avatar">AI</div>
                <div className="agent-body">
                  <div className="agent-text">
                    <span className="error">{b.error}</span>
                  </div>
                </div>
              </div>
            );
          }
          const res = b.response!;
          const lid = session.current.listId || res.pendingConfirmation?.args?.listId;
          return (
            <div key={i} className="agent-msg ai">
              <div className="agent-avatar">AI</div>
              <div className="agent-body">
                {res.actions && res.actions.length > 0 && (
                  <div className="agent-steps">
                    {res.actions.map((a, j) => (
                      <span key={j} className={`agent-step ${stepClass(a.status)}`}>
                        {STEP_LABELS[a.tool] || a.tool}
                      </span>
                    ))}
                  </div>
                )}
                <div className="agent-text">
                  <AgentText text={res.message} />
                </div>
                {res.sources && res.sources.length > 0 && (
                  <div className="agent-sources">
                    {res.sources.map((s, j) => (
                      <span key={j} className="agent-source" title={s.label}>
                        ✓ {s.label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="agent-actions">
                  {lid && (
                    <button className="btn ghost sm" onClick={() => navigate('#/lists/' + lid)}>
                      View contacts
                    </button>
                  )}
                  {res.pendingConfirmation && (
                    <button className="btn sm" onClick={() => setPending(res.pendingConfirmation!)}>
                      {res.pendingConfirmation.permission === 'destructive' ? 'Review & confirm' : 'Confirm'}
                    </button>
                  )}
                </div>
                <div className="agent-meta">
                  {res.model || ''}
                  {res.latency ? ' · ' + res.latency + 'ms' : ''}
                  {res.estimatedCost ? ' · ~$' + res.estimatedCost.toFixed(4) : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="agent-composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && submit()}
          placeholder="Ask about your lists…"
          autoComplete="off"
        />
        <button className="btn" onClick={() => submit()}>Send</button>
      </div>

      {pending && (
        <Modal
          onClose={() => setPending(null)}
          cardClassName={`agent-confirm ${pending.permission === 'destructive' ? 'danger' : ''}`}
          cardStyle={{ maxWidth: 440 }}
        >
          <div className="agent-confirm-head">
            {pending.permission === 'destructive' ? '⚠ Confirmation required' : '● Confirmation required'}
          </div>
          <p className="agent-confirm-body">{pending.summary}?</p>
          {pending.permission === 'destructive' && (
            <p className="agent-confirm-warn">This action cannot be undone.</p>
          )}
          <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            <button
              className={`btn ${pending.permission === 'destructive' ? 'danger' : ''}`}
              onClick={confirmPending}
            >
              {pending.permission === 'destructive' ? 'Confirm removal' : 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
