// Structured JSON-line logger for the agent, matching the app's existing
// console-based logging convention (see interfaces/http/middleware.js). No
// external dependency. Never logs secrets — callers pass already-redacted data.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level, event, fields) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope: 'agent',
    event,
    ...fields,
  });
  if (LEVELS[level] >= LEVELS.error) console.error(line);
  else if (LEVELS[level] >= LEVELS.warn) console.warn(line);
  else console.log(line);
}

export const agentLogger = {
  debug: (event, fields = {}) => emit('debug', event, fields),
  info: (event, fields = {}) => emit('info', event, fields),
  warn: (event, fields = {}) => emit('warn', event, fields),
  error: (event, fields = {}) => emit('error', event, fields),
};

export default agentLogger;
