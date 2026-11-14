/** Same-model retry, backoff and per-attempt timeout over an already selected
 * completion port. It never changes model/account and never replays tools.
 * Auth, context overflow, caller cancellation, content refusal and daily/billing
 * quotas remain distinct. The owner reports only observed attempts. */
import {
  SAFETY_BLOCK_TEXT,
  finishFailureKind,
  isFinishFailureMessage,
  type FinishFailureKind,
} from "./bridge/finish-reason.js";
import { isContextOverflowError } from "./context-overflow.js";
import { ProviderResponseError } from "./provider-error-facts.js";
import type { Context } from "./types/context.js";
import type { Model } from "./types/model.js";
import type { AssistantMessage } from "./types/agent-message.js";
import type { LlmCompletionPort, StreamOptions } from "./llm-api-runtime.js";

export type ProviderErrorKind =
  | "rate_limit"
  | "timeout"
  /** No first response (headers or stream event) within `firstResponseTimeoutMs`: the service hangs. */
  | "no_response"
  | "server"
  | "network"
  | "empty_response"
  | "malformed_tool_call"
  /** Provider refused on content grounds (Gemini safety block); never retried or re-routed. */
  | "safety_block"
  /** A quota that will not reset soon: do not retry. */
  | "quota_exhausted"
  /** The account is out of credit (402, OpenAI `insufficient_quota`): never retried; other providers only. */
  | "billing"
  | "context_overflow"
  | "auth"
  | "bad_request"
  /**
   * A successful (2xx) answer that is not JSON / an event stream, typically a site's HTML
   * home page because the service address lacks its API path (`/v1`). Never retried (#1250).
   */
  | "non_json_response"
  | "aborted"
  | "unknown";

export interface ProviderErrorClassification {
  readonly kind: ProviderErrorKind;
  /** Whether re-issuing the same request may succeed. */
  readonly retryable: boolean;
  readonly status?: number;
  /** Server-provided `Retry-After`, in milliseconds. */
  readonly retryAfterMs?: number;
}

export interface ProviderResilienceConfig {
  /** Retries per model after the first attempt. Default 2. `0` disables retry. */
  maxRetries?: number;
  /** First backoff delay in ms; doubles each retry. Default 1000. */
  baseDelayMs?: number;
  /** Upper bound for one backoff delay in ms. Default 10000. */
  maxDelayMs?: number;
  /** A `Retry-After` longer than this stops retry. Default 30000. */
  maxRetryAfterMs?: number;
  /** Per-attempt timeout in ms (whole streamed completion). Default 120000. `0` disables. */
  requestTimeoutMs?: number;
  /**
   * Per-attempt wait in ms for the provider's first response (response headers or the first
   * stream event). Default 30000. `0` disables. A service that does not answer in time is not
   * re-asked on the same model: the attempt fails as `no_response`.
   */
  firstResponseTimeoutMs?: number;
  /**
   * Extra attempts when the model returns neither text nor tool calls (or a tool call
   * without a name). Default 0: the reply is passed through unchanged. Quirk presets
   * (see model harness) raise this for models known to emit spurious empty replies.
   */
  emptyReplyRetries?: number;
}

export const DEFAULT_PROVIDER_RESILIENCE: Readonly<
  Required<ProviderResilienceConfig>
> = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 30_000,
  requestTimeoutMs: 120_000,
  firstResponseTimeoutMs: 30_000,
  emptyReplyRetries: 0,
});

export type ProviderResilienceEvent =
  | Readonly<{
      type: "retry";
      model: string;
      attempt: number;
      kind: ProviderErrorKind;
      delayMs: number;
      error: string;
    }>
  /** One attempt hit a timeout (logged by the owner with its turn / purpose context). */
  | Readonly<{
      type: "timeout";
      model: string;
      attempt: number;
      phase: "first_response" | "request";
      timeoutMs: number;
    }>
  | Readonly<{
      type: "give_up";
      model: string;
      kind: ProviderErrorKind;
      error: string;
    }>
  /** The model refused on content grounds; the refusal is passed to the user as-is. */
  | Readonly<{
      type: "refused";
      model: string;
      kind: "safety_block";
      error: string;
    }>;

/** Thrown after the selected model exhausted its attempts; carries a user-presentable message. */
export class ProviderRequestError extends Error {
  readonly kind: ProviderErrorKind;
  readonly attempts: number;

  constructor(kind: ProviderErrorKind, attempts: number, cause: unknown) {
    super(describeProviderFailure(kind), { cause });
    this.name = "ProviderRequestError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

const PROVIDER_FAILURE_TEXT: Record<ProviderErrorKind, string> = {
  rate_limit: "模型服务当前限流，请稍后再试",
  timeout: "模型服务响应超时，请稍后再试",
  no_response: "模型服务无响应，请稍后再试或联系管理员检查模型配置",
  server: "模型服务暂时不可用，请稍后再试",
  network: "连接模型服务失败，请检查网络后再试",
  empty_response: "模型返回了空回复，请换个说法再试",
  malformed_tool_call: "模型返回了无法解析的工具调用，请稍后再试",
  safety_block: SAFETY_BLOCK_TEXT,
  quota_exhausted:
    "模型服务今天的调用额度已用完，请稍后再试或联系管理员更换模型",
  billing: "模型服务账户余额不足或额度已用完，请联系管理员充值或检查账单",
  context_overflow: "对话内容超出模型上下文长度",
  auth: "模型服务鉴权失败，请检查 API 密钥配置",
  bad_request: "模型服务拒绝了请求",
  non_json_response: "服务返回的不是 JSON（可能少了 /v1），请检查服务地址",
  aborted: "请求已取消",
  unknown: "模型调用失败",
};

export function describeProviderFailure(kind: ProviderErrorKind): string {
  return PROVIDER_FAILURE_TEXT[kind];
}

const PROVIDER_FAILURE_MESSAGES = new Set(Object.values(PROVIDER_FAILURE_TEXT));
const PROVIDER_FAILURE_KINDS = new Map(
  Object.entries(PROVIDER_FAILURE_TEXT).map(([kind, text]) => [
    text,
    kind as ProviderErrorKind,
  ])
);

/** The failure kind behind a user-safe failure message (provider or finish), if it is one. */
export function providerFailureKind(
  text: string | undefined
): ProviderErrorKind | FinishFailureKind | undefined {
  if (!text) return undefined;
  return PROVIDER_FAILURE_KINDS.get(text) ?? finishFailureKind(text);
}

/** True when `text` is a {@link ProviderRequestError} message that is safe to show users as-is. */
export function isProviderFailureMessage(text: string): boolean {
  return PROVIDER_FAILURE_MESSAGES.has(text) || isFinishFailureMessage(text);
}

class EmptyResponseError extends Error {
  constructor(
    readonly kind: "empty_response" | "malformed_tool_call",
    readonly reply: AssistantMessage
  ) {
    super(
      kind === "empty_response"
        ? "Model returned an empty response"
        : "Model returned a malformed tool call"
    );
    this.name = "EmptyResponseError";
  }
}

/** The provider ended the stream with an `error` finish (not a malformed tool call). */
class ProviderFinishError extends Error {
  constructor(readonly reply: AssistantMessage) {
    super(reply.errorMessage ?? "Provider ended the response with an error");
    this.name = "ProviderFinishError";
  }
}

class AttemptTimeoutError extends Error {
  constructor(ms: number) {
    super(`Provider request timed out after ${ms}ms`);
    this.name = "AttemptTimeoutError";
  }
}

/** The provider sent neither response headers nor a stream event within the first-response window. */
export class FirstResponseTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Provider sent no response within ${timeoutMs}ms`);
    this.name = "FirstResponseTimeoutError";
  }
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** AI SDK `RetryError` wraps the real cause in `lastError`; unwrap before classifying. */
function unwrap(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    const rec = record(current);
    if (rec?.name === "AI_RetryError" && rec.lastError) {
      current = rec.lastError;
      continue;
    }
    break;
  }
  return current;
}

function headerValue(headers: unknown, name: string): string | undefined {
  const rec = record(headers);
  if (!rec) return undefined;
  if (typeof (rec as { get?: unknown }).get === "function") {
    const value = (rec as unknown as Headers).get(name);
    return value ?? undefined;
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Server-requested delay. OpenAI (and Azure OpenAI) send `retry-after-ms` with
 * millisecond precision next to the whole-second `retry-after`; prefer it.
 */
function retryAfterFromHeaders(headers: unknown): number | undefined {
  const msHeader = headerValue(headers, "retry-after-ms")?.trim();
  const ms = msHeader ? Number(msHeader) : Number.NaN;
  if (Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  return parseRetryAfterMs(headerValue(headers, "retry-after"));
}

export function parseRetryAfterMs(
  value: string | undefined,
  now = Date.now()
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function statusOf(error: Record<string, unknown>): number | undefined {
  for (const key of ["statusCode", "status"]) {
    const value = error[key];
    if (typeof value === "number" && value >= 100 && value < 600) return value;
  }
  return undefined;
}

interface GoogleRpcError {
  readonly status?: string;
  readonly reasons: readonly string[];
  /** `QuotaFailure.violations[].quotaId`, e.g. `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. */
  readonly quotaIds: readonly string[];
  readonly retryDelayMs?: number;
}

/**
 * Google APIs (Gemini) put the useful part of an error in the JSON body:
 * `error.status` (RESOURCE_EXHAUSTED, UNAVAILABLE, ...), `details[].reason`
 * (API_KEY_INVALID), `QuotaFailure.violations[].quotaId` and
 * `RetryInfo.retryDelay` ("37s") instead of a `Retry-After` header. Read it
 * from the AI SDK error's `data` or `responseBody`.
 */
export function parseGoogleRpcError(
  error: Record<string, unknown>
): GoogleRpcError | undefined {
  // Prefer the raw body: the SDK's parsed `data` keeps code/message/status but drops `details`.
  let body: unknown;
  if (typeof error.responseBody === "string") {
    try {
      body = JSON.parse(error.responseBody);
    } catch {
      body = undefined;
    }
  }
  body = record(body) ?? record(error.data);
  const inner = record(record(body)?.error);
  if (!inner) return undefined;
  const status = typeof inner.status === "string" ? inner.status : undefined;
  const reasons: string[] = [];
  const quotaIds: string[] = [];
  let retryDelayMs: number | undefined;
  for (const detail of Array.isArray(inner.details) ? inner.details : []) {
    const rec = record(detail);
    if (typeof rec?.reason === "string") reasons.push(rec.reason);
    for (const violation of Array.isArray(rec?.violations)
      ? rec.violations
      : []) {
      const quotaId = record(violation)?.quotaId;
      if (typeof quotaId === "string") quotaIds.push(quotaId);
    }
    const delay =
      typeof rec?.retryDelay === "string"
        ? /^(\d+(?:\.\d+)?)s$/.exec(rec.retryDelay)
        : null;
    if (delay) retryDelayMs = Math.round(Number(delay[1]) * 1000);
  }
  if (
    !status &&
    reasons.length === 0 &&
    quotaIds.length === 0 &&
    retryDelayMs === undefined
  )
    return undefined;
  return {
    ...(status ? { status } : {}),
    reasons,
    quotaIds,
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
  };
}

/** A per-day quota cannot recover before the daily reset, whatever `retryDelay` says. */
function isDailyQuota(google: GoogleRpcError | undefined): boolean {
  return google?.quotaIds.some((id) => /PerDay/i.test(id)) ?? false;
}

/**
 * Machine-readable error codes / types from an AI SDK error: `code` on the error
 * itself (stream errors), `data.error.code` / `.type` (parsed body) or the raw
 * `responseBody` (OpenAI: `{ "error": { "code": "insufficient_quota", ... } }`).
 */
function providerErrorCodes(error: Record<string, unknown>): Set<string> {
  const codes = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) codes.add(value);
  };
  add(error.code);
  add(error.type);
  let body: unknown;
  if (typeof error.responseBody === "string") {
    try {
      body = JSON.parse(error.responseBody);
    } catch {
      body = undefined;
    }
  }
  for (const source of [record(error.data), record(body)]) {
    const inner = record(source?.error) ?? source;
    add(inner?.code);
    add(inner?.type);
  }
  return codes;
}

/** Error codes / types that mean "this account cannot pay for the request". */
const BILLING_CODES = new Set([
  "insufficient_quota", // OpenAI (HTTP 429)
  "billing_error", // Anthropic (HTTP 402)
  "insufficient_balance",
  "payment_required",
  "exceeded_current_quota_error", // Moonshot (HTTP 429)
]);

/**
 * Provider wording for an empty balance. Deliberately excludes "check your plan and
 * billing details": Gemini's free-tier rate limit uses that sentence too.
 */
const BILLING_MESSAGE_PATTERN =
  /credit balance is too low|insufficient (?:account )?(?:balance|credits?|funds)|out of credits?|payment required|余额不足|账户已欠费/i;

function isBillingError(
  status: number | undefined,
  codes: ReadonlySet<string>,
  message: string
): boolean {
  if (status === 402) return true;
  for (const code of codes) if (BILLING_CODES.has(code)) return true;
  return BILLING_MESSAGE_PATTERN.test(message);
}

/** A 429 naming a per-day window: `requests per day (RPD)` / `tokens per day (TPD)`. */
const PER_DAY_LIMIT_PATTERN = /\bper day \((?:RPD|TPD)\)/i;

const GOOGLE_STATUS_PATTERN =
  /\b(RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|UNAUTHENTICATED|PERMISSION_DENIED)\b/;

export function classifyProviderError(
  error: unknown
): ProviderErrorClassification {
  const inner = unwrap(error);
  if (inner instanceof ProviderResponseError) return inner.classification;
  if (inner instanceof EmptyResponseError) {
    // Empty or nameless replies are re-asked only when a quirk preset opts in; they
    // never switch models, because an empty final answer can be legitimate.
    return { kind: inner.kind, retryable: true };
  }
  if (inner instanceof AttemptTimeoutError) {
    return { kind: "timeout", retryable: true };
  }
  if (inner instanceof FirstResponseTimeoutError) {
    return { kind: "no_response", retryable: false };
  }
  if (inner instanceof ProviderFinishError) {
    return { kind: "server", retryable: true };
  }
  const rec = record(inner) ?? {};
  const name = typeof rec.name === "string" ? rec.name : "";
  const message =
    typeof rec.message === "string" ? rec.message : String(inner ?? "");
  const status = statusOf(rec);
  const google = parseGoogleRpcError(rec);
  const retryAfterMs =
    retryAfterFromHeaders(rec.responseHeaders) ?? google?.retryDelayMs;
  const codes = providerErrorCodes(rec);
  // Gemini answers a bad key with 400 INVALID_ARGUMENT + reason API_KEY_INVALID: that is auth, not a model rejection.
  if (
    google?.reasons.some(
      (reason) => reason === "API_KEY_INVALID" || reason === "API_KEY_EXPIRED"
    )
  ) {
    return { kind: "auth", retryable: false, status };
  }
  // Gemini answers a server-side deadline with 504 DEADLINE_EXCEEDED: a timeout, not an outage.
  if (google?.status === "DEADLINE_EXCEEDED")
    return { kind: "timeout", retryable: true, status };
  if (isDailyQuota(google))
    return { kind: "quota_exhausted", retryable: false, status };
  // Groq (and OpenAI) name the exhausted window in the 429 message: "... on requests per
  // day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26s". A daily
  // window does not reopen within any sensible retry; Groq limits are per model, so
  // another candidate may still answer. Per-minute windows (RPM / TPM) stay rate limits.
  if (status === 429 && PER_DAY_LIMIT_PATTERN.test(message)) {
    return { kind: "quota_exhausted", retryable: false, status };
  }

  if (name === "AbortError") return { kind: "aborted", retryable: false };
  if (name === "TimeoutError") return { kind: "timeout", retryable: true };
  if (isContextOverflowError(inner)) {
    return { kind: "context_overflow", retryable: false, status };
  }
  // OpenAI answers an exhausted billing quota with 429 and Anthropic an empty balance
  // with 400, but no retry can succeed until someone adds credit. (Gemini's free-tier
  // "exceeded your current quota" has no such code and stays a rate limit / daily quota.)
  if (isBillingError(status, codes, message))
    return { kind: "billing", retryable: false, status };
  if (status === 429)
    return { kind: "rate_limit", retryable: true, status, retryAfterMs };
  if (status === 408) return { kind: "timeout", retryable: true, status };
  if (status === 401 || status === 403)
    return { kind: "auth", retryable: false, status };
  if (status !== undefined && status >= 500) {
    return { kind: "server", retryable: true, status, retryAfterMs };
  }
  // Model-specific rejections (unknown model, unsupported parameter) may succeed elsewhere.
  if (status !== undefined && status >= 400)
    return { kind: "bad_request", retryable: false, status };

  // Errors without an HTTP status (e.g. an error chunk inside a stream) still carry the Google RPC status.
  const rpcStatus = google?.status ?? GOOGLE_STATUS_PATTERN.exec(message)?.[1];
  if (rpcStatus === "RESOURCE_EXHAUSTED")
    return { kind: "rate_limit", retryable: true, retryAfterMs };
  if (rpcStatus === "UNAVAILABLE" || rpcStatus === "INTERNAL")
    return { kind: "server", retryable: true, retryAfterMs };
  if (rpcStatus === "DEADLINE_EXCEEDED")
    return { kind: "timeout", retryable: true };
  if (rpcStatus === "UNAUTHENTICATED" || rpcStatus === "PERMISSION_DENIED")
    return { kind: "auth", retryable: false };

  const code =
    typeof rec.code === "string" ? rec.code : record(rec.cause)?.code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) {
    return { kind: "network", retryable: true };
  }
  if (/rate.?limit|too many requests/i.test(message))
    return { kind: "rate_limit", retryable: true };
  if (/timed? ?out/i.test(message)) return { kind: "timeout", retryable: true };
  if (/fetch failed|socket hang up|network/i.test(message))
    return { kind: "network", retryable: true };
  return { kind: "unknown", retryable: false, status };
}

/** Exponential backoff with full jitter, honouring a server `Retry-After` when present. */
export function computeBackoffDelay(
  retryIndex: number,
  config: Pick<
    Required<ProviderResilienceConfig>,
    "baseDelayMs" | "maxDelayMs"
  >,
  retryAfterMs?: number,
  random: () => number = Math.random
): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const ceiling = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** retryIndex
  );
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Detect a reply that carries nothing usable, or a broken tool call: a call with no
 * name, or Gemini's MALFORMED_FUNCTION_CALL finish (surfaced by the bridge as an
 * error reply), or a provider-side `error` finish. Other error replies (safety
 * blocks included) pass through unchanged.
 */
function inspectReply(
  message: AssistantMessage
): EmptyResponseError | ProviderFinishError | undefined {
  if (message.stopReason === "error") {
    const finish = finishFailureKind(message.errorMessage);
    if (finish === "malformed_tool_call")
      return new EmptyResponseError("malformed_tool_call", message);
    if (finish === "provider_error") return new ProviderFinishError(message);
  }
  if (message.stopReason === "error" || message.stopReason === "aborted")
    return undefined;
  let hasPayload = false;
  for (const block of message.content) {
    if (block.type === "toolCall") {
      if (!block.name?.trim())
        return new EmptyResponseError("malformed_tool_call", message);
      hasPayload = true;
    } else if (block.type === "text" && block.text.trim()) {
      hasPayload = true;
    }
  }
  return hasPayload
    ? undefined
    : new EmptyResponseError("empty_response", message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Timer seam for the per-attempt timeout; evals inject a virtual clock. */
export interface ProviderTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: ProviderTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ResilientCompletionOptions {
  readonly config?: ProviderResilienceConfig;
  readonly onEvent?: (event: ProviderResilienceEvent) => void;
  /** Injected for tests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  /** Timers for the per-attempt timeout. Defaults to the real `setTimeout`. */
  readonly timers?: ProviderTimers;
}

export function resolveProviderResilienceConfig(
  ...layers: ReadonlyArray<ProviderResilienceConfig | undefined>
): Required<ProviderResilienceConfig> {
  const resolved: Required<ProviderResilienceConfig> = {
    ...DEFAULT_PROVIDER_RESILIENCE,
  };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(resolved) as Array<
      keyof ProviderResilienceConfig
    >) {
      const value = layer[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        resolved[key] = Math.floor(value);
      }
    }
  }
  return resolved;
}

/**
 * Decorate a completion port with same-model retry and timeout. The returned port issues
 * at most `(1 + maxRetries + emptyReplyRetries)` requests per model.
 */
export function createResilientCompletionPort(
  base: LlmCompletionPort,
  options: ResilientCompletionOptions = {}
): LlmCompletionPort {
  const config = resolveProviderResilienceConfig(options.config);
  const wait = options.sleep ?? sleep;
  const timers = options.timers ?? REAL_TIMERS;
  const reportEvent = (event: ProviderResilienceEvent): void => {
    // Diagnostics must not replace provider outcomes or control retry admission.
    try {
      options.onEvent?.(event);
    } catch {
      /* The caller owns its diagnostic sink. */
    }
  };

  async function attempt(
    call: "complete" | "completeSimple",
    model: Model,
    context: Context,
    streamOptions: StreamOptions | undefined,
    attemptNumber: number
  ): Promise<AssistantMessage> {
    const callerSignal = streamOptions?.signal;
    const timeoutMs =
      streamOptions?.requestTimeoutMs ?? config.requestTimeoutMs;
    const firstResponseMs = config.firstResponseTimeoutMs;
    const controller =
      timeoutMs > 0 || firstResponseMs > 0 ? new AbortController() : undefined;
    const timer =
      controller && timeoutMs > 0
        ? timers.setTimeout(
            () => controller.abort(new AttemptTimeoutError(timeoutMs)),
            timeoutMs
          )
        : undefined;
    let firstTimer =
      controller && firstResponseMs > 0
        ? timers.setTimeout(
            () => controller.abort(new FirstResponseTimeoutError(firstResponseMs)),
            firstResponseMs
          )
        : undefined;
    // The transport reports response headers / the first stream event; text also proves a response.
    const responded = (): void => {
      if (firstTimer !== undefined) {
        timers.clearTimeout(firstTimer);
        firstTimer = undefined;
      }
    };
    const signal = controller
      ? callerSignal
        ? AbortSignal.any([callerSignal, controller.signal])
        : controller.signal
      : callerSignal;
    const onTextDelta = streamOptions?.onTextDelta;
    const onResponseStart = streamOptions?.onResponseStart;
    try {
      // This wrapper owns retries; stop the SDK from multiplying them.
      const message = await base[call](model, context, {
        ...streamOptions,
        signal,
        maxRetries: 0,
        requestTimeoutMs: 0,
        onResponseStart: () => {
          responded();
          onResponseStart?.();
        },
        // Presence of `onTextDelta` selects streaming downstream: never add one.
        ...(onTextDelta
          ? {
              onTextDelta: (text: string) => {
                responded();
                onTextDelta(text);
              },
            }
          : {}),
      });
      const invalid = inspectReply(message);
      if (invalid) throw invalid;
      return message;
    } catch (error) {
      if (controller?.signal.aborted && !callerSignal?.aborted) {
        const reason: unknown = controller.signal.reason;
        if (reason instanceof FirstResponseTimeoutError || reason instanceof AttemptTimeoutError) {
          reportEvent({
            type: "timeout",
            model: model.id,
            attempt: attemptNumber,
            phase: reason instanceof FirstResponseTimeoutError ? "first_response" : "request",
            timeoutMs: reason instanceof FirstResponseTimeoutError ? reason.timeoutMs : timeoutMs,
          });
        }
        throw reason;
      }
      throw error;
    } finally {
      if (timer !== undefined) timers.clearTimeout(timer);
      if (firstTimer !== undefined) timers.clearTimeout(firstTimer);
    }
  }

  async function run(
    call: "complete" | "completeSimple",
    model: Model,
    context: Context,
    streamOptions?: StreamOptions
  ): Promise<AssistantMessage> {
    const signal = streamOptions?.signal;
    const explicitTimeout = streamOptions?.requestTimeoutMs;
    // Admission errors belong outside retry classification: the request was not submitted.
    if (explicitTimeout !== undefined && (!Number.isInteger(explicitTimeout) || explicitTimeout < 0 || explicitTimeout > 2_147_483_647)) {
      throw new RangeError("Invalid requestTimeoutMs");
    }
    let attempts = 0,
      retries = 0,
      emptyRetries = 0;
    while (true) {
      attempts++;
      try {
        const reply = await attempt(call, model, context, streamOptions, attempts);
        if (
          reply.stopReason === "error" &&
          finishFailureKind(reply.errorMessage) === "safety_block"
        ) {
          reportEvent({
            type: "refused",
            model: model.id,
            kind: "safety_block",
            error: reply.errorMessage ?? "",
          });
        }
        return reply;
      } catch (error) {
        if (signal?.aborted) throw error;
        const info = classifyProviderError(error);
        const quotaOrBilling =
          info.kind === "quota_exhausted" || info.kind === "billing";
        const message = error instanceof Error ? error.message : String(error);
        if (streamOptions?.retryAllowed?.() === false) {
          if (quotaOrBilling) {
            reportEvent({
              type: "give_up",
              model: model.id,
              kind: info.kind,
              error: message,
            });
            throw new ProviderRequestError(info.kind, attempts, error);
          }
          throw error;
        }
        // A hung service is not re-asked on the same model; callers with a fallback chain move on.
        if (info.kind === "no_response") {
          reportEvent({
            type: "give_up",
            model: model.id,
            kind: info.kind,
            error: message,
          });
          throw new ProviderRequestError(info.kind, attempts, error);
        }
        if (!info.retryable && !quotaOrBilling) throw error;
        const isEmpty = error instanceof EmptyResponseError;
        const budgetLeft = isEmpty
          ? emptyRetries < config.emptyReplyRetries
          : retries < config.maxRetries;
        const retryAfterTooLong =
          info.retryAfterMs !== undefined &&
          info.retryAfterMs > config.maxRetryAfterMs;
        if (info.retryable && budgetLeft && !retryAfterTooLong) {
          const delayMs = isEmpty
            ? 0
            : computeBackoffDelay(
                retries,
                config,
                info.retryAfterMs,
                options.random
              );
          if (isEmpty) emptyRetries++;
          else retries++;
          reportEvent({
            type: "retry",
            model: model.id,
            attempt: attempts,
            kind: info.kind,
            delayMs,
            error: message,
          });
          await wait(delayMs, signal);
          continue;
        }
        // Preserve the existing empty-reply recovery and quota/billing explanations.
        if (isEmpty) return error.reply;
        reportEvent({
          type: "give_up",
          model: model.id,
          kind: info.kind,
          error: message,
        });
        throw new ProviderRequestError(info.kind, attempts, error);
      }
    }
  }

  return {
    complete: (model, context, streamOptions) =>
      run("complete", model, context, streamOptions),
    completeSimple: (model, context, streamOptions) =>
      run("completeSimple", model, context, streamOptions),
  };
}
