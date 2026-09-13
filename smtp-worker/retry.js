// Bounded retry helper for transient conditions during a single verification
// request. We keep in-request retries small and fast (a couple of quick
// re-attempts on a transport hiccup). Greylisting (a 4xx recipient response) is
// NOT retried here with long waits — the worker reports "temporary" and the
// main app schedules the delayed retry using its existing greylist policy, so
// the customer is never double-charged and requests never hang.

export async function withRetry(fn, { maxRetries = 2, shouldRetry, delayMs = 200 } = {}) {
  let attempt = 0;
  let last;
  for (;;) {
    last = await fn(attempt);
    attempt += 1;
    if (attempt > maxRetries) break;
    if (typeof shouldRetry === 'function' && !shouldRetry(last)) break;
    await new Promise((r) => setTimeout(r, delayMs * attempt));
  }
  return { result: last, attempts: attempt };
}

// Retry only on transport errors (connection hiccups), never on a clean SMTP
// recipient response (accepted/rejected/temporary are real answers).
export function transportErrorRetryable(convResult) {
  return !!convResult.error && convResult.error !== 'timeout';
}
