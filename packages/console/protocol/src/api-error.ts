/**
 * Error body of an instance HTTP API call (`/api/message/send`, `/api/assistant/jobs`, …) — #1250.
 *
 * Two kinds of failure are told apart:
 *
 * - An **expected** failure (a delivery the platform refused, a missing target, an invalid
 *   argument) carries a stable {@link ConsoleApiErrorCode} and a user-facing Chinese explanation in
 *   `error`; `data` may add a structured detail (e.g. a `ConsoleSendFailure`). It never carries a
 *   stack, a raw exception message or other internal detail.
 * - An **unexpected** exception is answered with `code: 'internal_error'`, the generic
 *   {@link CONSOLE_INTERNAL_ERROR_MESSAGE} and an `errorId`. The instance logs the real error with the
 *   same id (`errorId: <id>` in the log line), so an operator can find it with `zhin logs`.
 */
export type ConsoleApiErrorCode =
  /** Unexpected exception; see `errorId`. */
  | 'internal_error'
  /** A request field is missing or invalid. */
  | 'invalid_argument'
  /** The addressed object (job, …) does not exist. */
  | 'not_found'
  /** The needed runtime part is not running or not enabled. */
  | 'unavailable'
  /** No Endpoint with that adapter / key exists. */
  | 'endpoint_not_found'
  /** The message was not delivered (safe to retry); `data` is a `ConsoleSendFailure`. HTTP 502. */
  | 'delivery_failed'
  /**
   * The delivery outcome is unknown: the platform may have accepted the message (`data` is a
   * `ConsoleSendFailure` with `reason: 'delivery_unknown'`, `status: 'unknown'`). HTTP 502 like
   * `delivery_failed`, but kept apart so a client does not retry it blindly and send twice.
   */
  | 'delivery_unknown'
  /** `notify.channel: im` without a target conversation. */
  | 'notify_target_missing';

/** Client-facing message of an unexpected failure. */
export const CONSOLE_INTERNAL_ERROR_MESSAGE = 'Internal error';

export interface ConsoleApiErrorBody<TData = unknown> {
  readonly success: false;
  /** Stable classification; older instances may omit it or send other codes. */
  readonly code?: ConsoleApiErrorCode | (string & {});
  /** User-facing explanation (Chinese for expected failures; the generic message otherwise). */
  readonly error: string;
  /** Log correlation id of an unexpected failure (`code: 'internal_error'`). */
  readonly errorId?: string;
  readonly data?: TData;
}

/** True for a JSON body shaped like {@link ConsoleApiErrorBody}. */
export function isConsoleApiErrorBody(value: unknown): value is ConsoleApiErrorBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as { success?: unknown; error?: unknown; code?: unknown; errorId?: unknown };
  return record.success === false && typeof record.error === 'string'
    && (record.code === undefined || typeof record.code === 'string')
    && (record.errorId === undefined || typeof record.errorId === 'string');
}

/** Shape of a log correlation id: `err_` + 12 lowercase hex characters. */
export const CONSOLE_ERROR_ID_PATTERN = /^err_[0-9a-f]{12}$/u;
