// Lightly structures the agent's plain-text answer: bolds the "Verified facts:"
// and "Recommendation:" leads while preserving line breaks. Moved verbatim from
// AgentView. Presentation only.
import type { ReactNode } from 'react';

export function AgentText({ text }: { text: string }) {
  const lines = (text || '').split('\n');
  return (
    <>
      {lines.map((line, i) => {
        let node: ReactNode = line;
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
