export class TriggerCancelledError extends Error {
  readonly sessionKey: string;

  constructor(sessionKey: string) {
    super(`Turn cancelled by user for session ${sessionKey}`);
    this.name = 'TriggerCancelledError';
    this.sessionKey = sessionKey;
  }
}

export class TriggerTimeoutError extends Error {
  readonly sessionKey: string;
  readonly timeoutMs: number;

  constructor(sessionKey: string, timeoutMs: number) {
    super(`Turn timed out after ${timeoutMs}ms for session ${sessionKey}`);
    this.name = 'TriggerTimeoutError';
    this.sessionKey = sessionKey;
    this.timeoutMs = timeoutMs;
  }
}
