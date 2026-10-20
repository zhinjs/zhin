/**
 * Error categories surfaced by @zhin.js/plugin-nettools.
 *
 * Every failure that reaches a user is a {@link NettoolsError} so commands and
 * Agent tools can render one consistent, human-readable message instead of a
 * raw stack trace or provider payload.
 */
export type NettoolsErrorKind =
  | 'invalid_input'
  | 'blocked_target'
  | 'cooldown'
  | 'timeout'
  | 'rate_limited'
  | 'http'
  | 'network'
  | 'malformed'
  | 'not_found'
  | 'aborted';

export class NettoolsError extends Error {
  readonly kind: NettoolsErrorKind;
  /** HTTP status when the failure came from a provider response. */
  readonly status?: number;
  /** Milliseconds the caller should wait before retrying (cooldown / 429). */
  readonly retryAfterMs?: number;

  constructor(
    kind: NettoolsErrorKind,
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'NettoolsError';
    this.kind = kind;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

export function isNettoolsError(error: unknown): error is NettoolsError {
  return error instanceof NettoolsError;
}

/** Render any thrown value as a short user-facing sentence. */
export function describeFailure(error: unknown): string {
  if (!isNettoolsError(error)) {
    const detail = error instanceof Error ? error.message : String(error);
    return `出错了：${detail}`;
  }
  return error.message;
}
