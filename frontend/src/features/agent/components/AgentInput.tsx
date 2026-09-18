// Agent composer: text input + send. Enter submits. Extracted from AgentView.
import type { KeyboardEvent } from 'react';

export function AgentInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="agent-composer">
      <label className="visually-hidden" htmlFor="agent-input">Ask MailHealth AI about your lists</label>
      <input
        id="agent-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && onSubmit()}
        placeholder="Ask about your lists…"
        autoComplete="off"
      />
      <button className="btn" onClick={onSubmit} disabled={disabled}>Send</button>
    </div>
  );
}
