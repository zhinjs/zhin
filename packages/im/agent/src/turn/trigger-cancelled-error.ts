export class TriggerCancelledError extends Error {
  readonly sessionKey: string;

  constructor(sessionKey: string) {
    super(`Turn cancelled by user for session ${sessionKey}`);
    this.name = 'TriggerCancelledError';
    this.sessionKey = sessionKey;
  }
}

/**
 * The turn ran past its trigger deadline (`ai.trigger.timeout`). The single class behind
 * `@zhin.js/agent/turn` and `@zhin.js/agent/runtime` (#1250 第 56 批): the ingress deadline throws it
 * and the tool runtime recognises it as harness-generated.
 */
export class TriggerTimeoutError extends Error {
  /** Session the timed-out turn belonged to, when the thrower knows it. */
  readonly sessionKey?: string;
  readonly timeoutMs: number;

  constructor(timeoutMs: number);
  /** @deprecated Session-first form kept for compatibility; prefer `new TriggerTimeoutError(timeoutMs)`. */
  constructor(sessionKey: string, timeoutMs: number);
  constructor(first: number | string, second?: number) {
    const timeoutMs = typeof first === 'number' ? first : second ?? 0;
    super(`AI 处理超时（${timeoutMs}ms）`);
    this.name = 'TriggerTimeoutError';
    if (typeof first === 'string') this.sessionKey = first;
    this.timeoutMs = timeoutMs;
  }
}
