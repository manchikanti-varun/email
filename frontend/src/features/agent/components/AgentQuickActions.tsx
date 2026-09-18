// Quick-action prompt chips. Clicking one submits it as a message.
import { QUICK_ACTIONS } from './agent-constants';

export function AgentQuickActions({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="agent-quick">
      {QUICK_ACTIONS.map((q) => (
        <button key={q} className="agent-chip" onClick={() => onPick(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
