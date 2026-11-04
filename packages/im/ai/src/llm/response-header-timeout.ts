/**
 * Bound the wait for response headers with the provider's `firstChunkTimeoutMs`.
 * The AI SDK starts its own first-chunk timer only after headers arrive, so a server
 * that never answers would otherwise hang until the request timeout. Aborts with a
 * `TimeoutError`, which the resilience layer classifies as a retryable timeout.
 */
export function withResponseHeaderTimeout(
  fetchFn: typeof globalThis.fetch | undefined,
  timeoutMs: number | undefined,
): typeof globalThis.fetch | undefined {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchFn;
  const ms = Math.floor(timeoutMs);
  return (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException(`No response headers within ${ms}ms`, 'TimeoutError'));
    }, ms);
    const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = upstreamSignal ? AbortSignal.any([upstreamSignal, controller.signal]) : controller.signal;
    try {
      return await (fetchFn ?? globalThis.fetch)(input, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof globalThis.fetch;
}
