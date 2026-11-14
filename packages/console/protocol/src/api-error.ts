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

/**
 * Why an optional feature of the instance is off (#1250): the read succeeds with this state
 * instead of failing, so a client shows "not installed / not enabled" rather than a read error.
 * - `agent-not-installed`: the `@zhin.js/agent` package is not installed.
 * - `agent-disabled`: the package is installed but no Agent runs in this generation (AI not enabled).
 * - `assistant-disabled`: the Agent runs but `assistant.enabled` is false.
 */
export type ConsoleFeatureDisabledReason = 'agent-not-installed' | 'agent-disabled' | 'assistant-disabled';

/**
 * State of a feature that is off, returned by reads as `data` (HTTP 200, `success: true`, with the
 * normal payload left empty) and by writes as `data` of a 404 `code: 'unavailable'` error body.
 */
export interface ConsoleFeatureDisabled {
  readonly status: 'disabled';
  readonly reason: ConsoleFeatureDisabledReason;
  /** User-facing Chinese explanation with the next step. */
  readonly message: string;
}

export const CONSOLE_FEATURE_DISABLED_MESSAGES: Readonly<Record<ConsoleFeatureDisabledReason, string>> = Object.freeze({
  'agent-not-installed': '未安装 AI 智能体（@zhin.js/agent）：运行 zhin setup --ai 或在 Console 引导中启用 AI 后可用',
  'agent-disabled': 'AI 智能体未启用：在 Console 引导或配置中启用 AI 后可用',
  'assistant-disabled': '助手未启用：在配置中设置 assistant.enabled: true 后可用',
});

export function consoleFeatureDisabled(reason: ConsoleFeatureDisabledReason): ConsoleFeatureDisabled {
  return Object.freeze({ status: 'disabled', reason, message: CONSOLE_FEATURE_DISABLED_MESSAGES[reason] });
}

/** True for a {@link ConsoleFeatureDisabled} value (e.g. `data` of a read). */
export function isConsoleFeatureDisabled(value: unknown): value is ConsoleFeatureDisabled {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'disabled'
    && typeof (value as { reason?: unknown }).reason === 'string';
}
