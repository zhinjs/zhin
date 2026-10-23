/**
 * Provider resilience: error classification, bounded retry with backoff, per-attempt
 * timeout, and model fallback for a single LLM completion.
 *
 * The wrapper decorates an existing {@link LlmCompletionPort}; it never replays tool
 * side effects because it only re-issues one completion request. Errors that are not
 * worth retrying (auth, bad request, context overflow, caller abort) are re-thrown
 * unchanged so existing handlers such as context-overflow compaction keep working.
 *
 * Gemini specifics (see docs/ai/index.md and the tests in google-gemini-provider.test.ts):
 * - 429 RESOURCE_EXHAUSTED is retried after `RetryInfo.retryDelay`, except a per-day
 *   quota (`QuotaFailure.violations[].quotaId` containing `PerDay`): retrying cannot
 *   succeed before the daily reset, so it skips retries and goes straight to fallback
 *   (quotas are per project *and model*, so another model may still have quota).
 * - 503 UNAVAILABLE / 500 INTERNAL are retried with backoff, then fall back.
 * - 504 DEADLINE_EXCEEDED is a timeout, like our own per-attempt timeout.
 * - A safety block (finishReason SAFETY / PROHIBITED_CONTENT / BLOCKLIST / SPII /
 *   IMAGE_SAFETY / RECITATION, or a prompt `blockReason`) is final: no retry and no
 *   fallback. The verdict is about the content, so the same request gets the same
 *   answer; switching models to get past a refusal would bypass the operator's
 *   safety settings and resend flagged content to more models. The user gets a
 *   polite refusal instead (see `bridge/finish-reason.ts`).
 *
 * Other providers:
 * - An `error` finish that is not a malformed tool call (DeepSeek
 *   `insufficient_system_resource`) is retried with backoff like a 5xx, then falls back.
 * - Error parts inside a 200 stream (Anthropic `overloaded_error`, OpenAI `server_error`)
 *   keep their type and an inferred status (see `bridge/stream-error.ts`), so they are
 *   classified like the equivalent HTTP error.
 *
 * Groq: a 429 is retried after `retry-after` (seconds, only sent on a 429) when a
 * per-minute window (RPM / TPM) ran out; a per-day window (RPD / TPD, named in the
 * message) is `quota_exhausted` and falls back like the Gemini PerDay quota.
 *
 * Out of credit (402 Payment Required, OpenAI `insufficient_quota`, Anthropic "credit
 * balance is too low", DeepSeek "Insufficient Balance", OpenRouter "Insufficient
 * credits") is classified `billing`: never retried, because nothing changes until
 * someone pays. Fallback skips every candidate on the *same provider alias*: all models
 * of one alias share its API key and therefore its account, so asking them would only
 * repeat the failure (and add latency). A candidate on another alias has its own key
 * and is still tried. When none is left the user is told the balance ran out instead
 * of "try again later", which would not help. Distinct aliases that happen to reuse a
 * key are not detected; that is a configuration choice, and the cost is one extra
 * failed request.
 */
import { SAFETY_BLOCK_TEXT, finishFailureKind, isFinishFailureMessage, type FinishFailureKind } from './bridge/finish-reason.js';
import { isContextOverflowError } from './context-overflow.js';
import type { Context } from './types/context.js';
import type { Model } from './types/model.js';
import type { AssistantMessage } from './types/agent-message.js';
import type { LlmCompletionPort, StreamOptions } from './llm-api-runtime.js';

export type ProviderErrorKind =
  | 'rate_limit'
  | 'timeout'
  | 'server'
  | 'network'
  | 'empty_response'
  | 'malformed_tool_call'
  /** Provider refused on content grounds (Gemini safety block); never retried or re-routed. */
  | 'safety_block'
  /** A quota that will not reset soon (Gemini per-day quota): skip retries, try fallback. */
  | 'quota_exhausted'
  /** The account is out of credit (402, OpenAI `insufficient_quota`): never retried; other providers only. */
  | 'billing'
  | 'context_overflow'
  | 'auth'
  | 'bad_request'
  | 'aborted'
  | 'unknown';

export interface ProviderErrorClassification {
  readonly kind: ProviderErrorKind;
  /** Whether re-issuing the same request may succeed. */
  readonly retryable: boolean;
  /** Whether a different model may succeed where this one failed. */
  readonly fallbackEligible: boolean;
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
  /** A `Retry-After` longer than this skips retry and goes to fallback. Default 30000. */
  maxRetryAfterMs?: number;
  /** Per-attempt timeout in ms (whole streamed completion). Default 180000. `0` disables. */
  requestTimeoutMs?: number;
  /**
   * Extra attempts when the model returns neither text nor tool calls (or a tool call
   * without a name). Default 0: the reply is passed through unchanged. Quirk presets
   * (see model harness) raise this for models known to emit spurious empty replies.
   */
  emptyReplyRetries?: number;
  /** Try the next entry of `modelCandidates` after retries are exhausted. Default true. */
  fallback?: boolean;
}

export const DEFAULT_PROVIDER_RESILIENCE: Readonly<Required<ProviderResilienceConfig>> = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 30_000,
  requestTimeoutMs: 180_000,
  emptyReplyRetries: 0,
  fallback: true,
});

export type ProviderResilienceEvent =
  | Readonly<{ type: 'retry'; model: string; attempt: number; kind: ProviderErrorKind; delayMs: number; error: string }>
  | Readonly<{ type: 'fallback'; from: string; to: string; kind: ProviderErrorKind; error: string }>
  | Readonly<{ type: 'give_up'; model: string; kind: ProviderErrorKind; error: string }>
  /** The model refused on content grounds; the refusal is passed to the user as-is. */
  | Readonly<{ type: 'refused'; model: string; kind: 'safety_block'; error: string }>;

/** Thrown after every attempt and fallback failed; carries a user-presentable message. */
export class ProviderRequestError extends Error {
  readonly kind: ProviderErrorKind;
  readonly attempts: number;

  constructor(kind: ProviderErrorKind, attempts: number, cause: unknown) {
    super(describeProviderFailure(kind), { cause });
    this.name = 'ProviderRequestError';
    this.kind = kind;
    this.attempts = attempts;
  }
}

const PROVIDER_FAILURE_TEXT: Record<ProviderErrorKind, string> = {
  rate_limit: '模型服务当前限流，已自动重试仍未成功，请稍后再试',
  timeout: '模型服务响应超时，已自动重试仍未成功，请稍后再试',
  server: '模型服务暂时不可用，已自动重试仍未成功，请稍后再试',
  network: '连接模型服务失败，已自动重试仍未成功，请检查网络后再试',
  empty_response: '模型返回了空回复，已自动重试仍未成功，请换个说法再试',
  malformed_tool_call: '模型返回了无法解析的工具调用，已自动重试仍未成功，请稍后再试',
  safety_block: SAFETY_BLOCK_TEXT,
  quota_exhausted: '模型服务今天的调用额度已用完，请稍后再试或联系管理员更换模型',
  billing: '模型服务账户余额不足或额度已用完，请联系管理员充值或检查账单',
  context_overflow: '对话内容超出模型上下文长度',
  auth: '模型服务鉴权失败，请检查 API 密钥配置',
  bad_request: '模型服务拒绝了请求',
  aborted: '请求已取消',
  unknown: '模型调用失败',
};

export function describeProviderFailure(kind: ProviderErrorKind): string {
  return PROVIDER_FAILURE_TEXT[kind];
}

const PROVIDER_FAILURE_MESSAGES = new Set(Object.values(PROVIDER_FAILURE_TEXT));
const PROVIDER_FAILURE_KINDS = new Map(Object.entries(PROVIDER_FAILURE_TEXT).map(([kind, text]) => [text, kind as ProviderErrorKind]));

/** The failure kind behind a user-safe failure message (provider or finish), if it is one. */
export function providerFailureKind(text: string | undefined): ProviderErrorKind | FinishFailureKind | undefined {
  if (!text) return undefined;
  return PROVIDER_FAILURE_KINDS.get(text) ?? finishFailureKind(text);
}

/** True when `text` is a {@link ProviderRequestError} message that is safe to show users as-is. */
export function isProviderFailureMessage(text: string): boolean {
  return PROVIDER_FAILURE_MESSAGES.has(text) || isFinishFailureMessage(text);
}

class EmptyResponseError extends Error {
  constructor(
    readonly kind: 'empty_response' | 'malformed_tool_call',
    readonly reply: AssistantMessage,
  ) {
    super(kind === 'empty_response' ? 'Model returned an empty response' : 'Model returned a malformed tool call');
    this.name = 'EmptyResponseError';
  }
}

/** The provider ended the stream with an `error` finish (not a malformed tool call). */
class ProviderFinishError extends Error {
  constructor(readonly reply: AssistantMessage) {
    super(reply.errorMessage ?? 'Provider ended the response with an error');
    this.name = 'ProviderFinishError';
  }
}

class AttemptTimeoutError extends Error {
  constructor(ms: number) {
    super(`Provider request timed out after ${ms}ms`);
    this.name = 'AttemptTimeoutError';
  }
}

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** AI SDK `RetryError` wraps the real cause in `lastError`; unwrap before classifying. */
function unwrap(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    const rec = record(current);
    if (rec?.name === 'AI_RetryError' && rec.lastError) {
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
  if (typeof (rec as { get?: unknown }).get === 'function') {
    const value = (rec as unknown as Headers).get(name);
    return value ?? undefined;
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * Server-requested delay. OpenAI (and Azure OpenAI) send `retry-after-ms` with
 * millisecond precision next to the whole-second `retry-after`; prefer it.
 */
function retryAfterFromHeaders(headers: unknown): number | undefined {
  const msHeader = headerValue(headers, 'retry-after-ms')?.trim();
  const ms = msHeader ? Number(msHeader) : Number.NaN;
  if (Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  return parseRetryAfterMs(headerValue(headers, 'retry-after'));
}

export function parseRetryAfterMs(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function statusOf(error: Record<string, unknown>): number | undefined {
  for (const key of ['statusCode', 'status']) {
    const value = error[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
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
export function parseGoogleRpcError(error: Record<string, unknown>): GoogleRpcError | undefined {
  // Prefer the raw body: the SDK's parsed `data` keeps code/message/status but drops `details`.
  let body: unknown;
  if (typeof error.responseBody === 'string') {
    try {
      body = JSON.parse(error.responseBody);
    } catch {
      body = undefined;
    }
  }
  body = record(body) ?? record(error.data);
  const inner = record(record(body)?.error);
  if (!inner) return undefined;
  const status = typeof inner.status === 'string' ? inner.status : undefined;
  const reasons: string[] = [];
  const quotaIds: string[] = [];
  let retryDelayMs: number | undefined;
  for (const detail of Array.isArray(inner.details) ? inner.details : []) {
    const rec = record(detail);
    if (typeof rec?.reason === 'string') reasons.push(rec.reason);
    for (const violation of Array.isArray(rec?.violations) ? rec.violations : []) {
      const quotaId = record(violation)?.quotaId;
      if (typeof quotaId === 'string') quotaIds.push(quotaId);
    }
    const delay = typeof rec?.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(rec.retryDelay) : null;
    if (delay) retryDelayMs = Math.round(Number(delay[1]) * 1000);
  }
  if (!status && reasons.length === 0 && quotaIds.length === 0 && retryDelayMs === undefined) return undefined;
  return { ...(status ? { status } : {}), reasons, quotaIds, ...(retryDelayMs !== undefined ? { retryDelayMs } : {}) };
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
    if (typeof value === 'string' && value) codes.add(value);
  };
  add(error.code);
  add(error.type);
  let body: unknown;
  if (typeof error.responseBody === 'string') {
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
  'insufficient_quota', // OpenAI (HTTP 429)
  'billing_error', // Anthropic (HTTP 402)
  'insufficient_balance',
  'payment_required',
  'exceeded_current_quota_error', // Moonshot (HTTP 429)
]);

/**
 * Provider wording for an empty balance. Deliberately excludes "check your plan and
 * billing details": Gemini's free-tier rate limit uses that sentence too.
 */
const BILLING_MESSAGE_PATTERN = /credit balance is too low|insufficient (?:account )?(?:balance|credits?|funds)|out of credits?|payment required|余额不足|账户已欠费/i;

function isBillingError(status: number | undefined, codes: ReadonlySet<string>, message: string): boolean {
  if (status === 402) return true;
  for (const code of codes) if (BILLING_CODES.has(code)) return true;
  return BILLING_MESSAGE_PATTERN.test(message);
}

/** A 429 naming a per-day window: `requests per day (RPD)` / `tokens per day (TPD)`. */
const PER_DAY_LIMIT_PATTERN = /\bper day \((?:RPD|TPD)\)/i;

const GOOGLE_STATUS_PATTERN = /\b(RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|UNAUTHENTICATED|PERMISSION_DENIED)\b/;

export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const inner = unwrap(error);
  if (inner instanceof EmptyResponseError) {
    // Empty or nameless replies are re-asked only when a quirk preset opts in; they
    // never switch models, because an empty final answer can be legitimate.
    return { kind: inner.kind, retryable: true, fallbackEligible: false };
  }
  if (inner instanceof AttemptTimeoutError) {
    return { kind: 'timeout', retryable: true, fallbackEligible: true };
  }
  if (inner instanceof ProviderFinishError) {
    return { kind: 'server', retryable: true, fallbackEligible: true };
  }
  const rec = record(inner) ?? {};
  const name = typeof rec.name === 'string' ? rec.name : '';
  const message = typeof rec.message === 'string' ? rec.message : String(inner ?? '');
  const status = statusOf(rec);
  const google = parseGoogleRpcError(rec);
  const retryAfterMs = retryAfterFromHeaders(rec.responseHeaders) ?? google?.retryDelayMs;
  const codes = providerErrorCodes(rec);
  // Gemini answers a bad key with 400 INVALID_ARGUMENT + reason API_KEY_INVALID: that is auth, not a model rejection.
  if (google?.reasons.some((reason) => reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED')) {
    return { kind: 'auth', retryable: false, fallbackEligible: false, status };
  }
  // Gemini answers a server-side deadline with 504 DEADLINE_EXCEEDED: a timeout, not an outage.
  if (google?.status === 'DEADLINE_EXCEEDED') return { kind: 'timeout', retryable: true, fallbackEligible: true, status };
  if (isDailyQuota(google)) return { kind: 'quota_exhausted', retryable: false, fallbackEligible: true, status };
  // Groq (and OpenAI) name the exhausted window in the 429 message: "... on requests per
  // day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26s". A daily
  // window does not reopen within any sensible retry; Groq limits are per model, so
  // another candidate may still answer. Per-minute windows (RPM / TPM) stay rate limits.
  if (status === 429 && PER_DAY_LIMIT_PATTERN.test(message)) {
    return { kind: 'quota_exhausted', retryable: false, fallbackEligible: true, status };
  }

  if (name === 'AbortError') return { kind: 'aborted', retryable: false, fallbackEligible: false };
  if (name === 'TimeoutError') return { kind: 'timeout', retryable: true, fallbackEligible: true };
  if (isContextOverflowError(inner)) {
    return { kind: 'context_overflow', retryable: false, fallbackEligible: false, status };
  }
  // OpenAI answers an exhausted billing quota with 429 and Anthropic an empty balance
  // with 400, but no retry can succeed until someone adds credit. (Gemini's free-tier
  // "exceeded your current quota" has no such code and stays a rate limit / daily quota.)
  if (isBillingError(status, codes, message)) return { kind: 'billing', retryable: false, fallbackEligible: true, status };
  if (status === 429) return { kind: 'rate_limit', retryable: true, fallbackEligible: true, status, retryAfterMs };
  if (status === 408) return { kind: 'timeout', retryable: true, fallbackEligible: true, status };
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false, fallbackEligible: false, status };
  if (status !== undefined && status >= 500) {
    return { kind: 'server', retryable: true, fallbackEligible: true, status, retryAfterMs };
  }
  // Model-specific rejections (unknown model, unsupported parameter) may succeed elsewhere.
  if (status !== undefined && status >= 400) return { kind: 'bad_request', retryable: false, fallbackEligible: true, status };

  // Errors without an HTTP status (e.g. an error chunk inside a stream) still carry the Google RPC status.
  const rpcStatus = google?.status ?? GOOGLE_STATUS_PATTERN.exec(message)?.[1];
  if (rpcStatus === 'RESOURCE_EXHAUSTED') return { kind: 'rate_limit', retryable: true, fallbackEligible: true, retryAfterMs };
  if (rpcStatus === 'UNAVAILABLE' || rpcStatus === 'INTERNAL') return { kind: 'server', retryable: true, fallbackEligible: true, retryAfterMs };
  if (rpcStatus === 'DEADLINE_EXCEEDED') return { kind: 'timeout', retryable: true, fallbackEligible: true };
  if (rpcStatus === 'UNAUTHENTICATED' || rpcStatus === 'PERMISSION_DENIED') return { kind: 'auth', retryable: false, fallbackEligible: false };

  const code = typeof rec.code === 'string' ? rec.code : record(rec.cause)?.code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) {
    return { kind: 'network', retryable: true, fallbackEligible: true };
  }
  if (/rate.?limit|too many requests/i.test(message)) return { kind: 'rate_limit', retryable: true, fallbackEligible: true };
  if (/timed? ?out/i.test(message)) return { kind: 'timeout', retryable: true, fallbackEligible: true };
  if (/fetch failed|socket hang up|network/i.test(message)) return { kind: 'network', retryable: true, fallbackEligible: true };
  return { kind: 'unknown', retryable: false, fallbackEligible: false, status };
}

/** Exponential backoff with full jitter, honouring a server `Retry-After` when present. */
export function computeBackoffDelay(
  retryIndex: number,
  config: Pick<Required<ProviderResilienceConfig>, 'baseDelayMs' | 'maxDelayMs'>,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const ceiling = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** retryIndex);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Detect a reply that carries nothing usable, or a broken tool call: a call with no
 * name, or Gemini's MALFORMED_FUNCTION_CALL finish (surfaced by the bridge as an
 * error reply), or a provider-side `error` finish. Other error replies (safety
 * blocks included) pass through unchanged.
 */
function inspectReply(message: AssistantMessage): EmptyResponseError | ProviderFinishError | undefined {
  if (message.stopReason === 'error') {
    const finish = finishFailureKind(message.errorMessage);
    if (finish === 'malformed_tool_call') return new EmptyResponseError('malformed_tool_call', message);
    if (finish === 'provider_error') return new ProviderFinishError(message);
  }
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return undefined;
  let hasPayload = false;
  for (const block of message.content) {
    if (block.type === 'toolCall') {
      if (!block.name?.trim()) return new EmptyResponseError('malformed_tool_call', message);
      hasPayload = true;
    } else if (block.type === 'text' && block.text.trim()) {
      hasPayload = true;
    }
  }
  return hasPayload ? undefined : new EmptyResponseError('empty_response', message);
}

/**
 * Index of the fallback candidate to try after `models[current]` failed with `kind`,
 * or -1. An empty balance belongs to the account behind the provider alias, so for
 * `billing` every candidate on the same alias (same key) is skipped.
 */
function nextCandidateIndex(models: readonly Model[], current: number, kind: ProviderErrorKind): number {
  const failed = models[current]!;
  for (let i = current + 1; i < models.length; i++) {
    if (kind === 'billing' && models[i]!.provider === failed.provider) continue;
    return i;
  }
  return -1;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Timer seam for the per-attempt timeout; evals inject a virtual clock. */
export interface ProviderTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: ProviderTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ResilientCompletionOptions {
  readonly config?: ProviderResilienceConfig;
  /** Ordered fallback models tried after the primary model is exhausted. */
  readonly fallbackModels?: readonly Model[];
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
  const resolved: Required<ProviderResilienceConfig> = { ...DEFAULT_PROVIDER_RESILIENCE };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(resolved) as Array<keyof ProviderResilienceConfig>) {
      const value = layer[key];
      if (key === 'fallback') {
        if (typeof value === 'boolean') resolved.fallback = value;
      } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        resolved[key] = Math.floor(value);
      }
    }
  }
  return resolved;
}

/**
 * Decorate a completion port with retry, timeout and fallback. The returned port issues
 * at most `(1 + maxRetries + emptyReplyRetries)` requests per model.
 */
export function createResilientCompletionPort(
  base: LlmCompletionPort,
  options: ResilientCompletionOptions = {},
): LlmCompletionPort {
  const config = resolveProviderResilienceConfig(options.config);
  const wait = options.sleep ?? sleep;
  const timers = options.timers ?? REAL_TIMERS;

  async function attempt(
    call: 'complete' | 'completeSimple',
    model: Model,
    context: Context,
    streamOptions: StreamOptions | undefined,
  ): Promise<AssistantMessage> {
    const callerSignal = streamOptions?.signal;
    const timeoutMs = config.requestTimeoutMs;
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller
      ? timers.setTimeout(() => controller.abort(new AttemptTimeoutError(timeoutMs)), timeoutMs)
      : undefined;
    const signal = controller
      ? (callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal)
      : callerSignal;
    try {
      // This wrapper owns retries; stop the SDK from multiplying them.
      const message = await base[call](model, context, { ...streamOptions, signal, maxRetries: 0 });
      const invalid = inspectReply(message);
      if (invalid) throw invalid;
      return message;
    } catch (error) {
      if (controller?.signal.aborted && !callerSignal?.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      if (timer !== undefined) timers.clearTimeout(timer);
    }
  }

  async function run(
    call: 'complete' | 'completeSimple',
    primary: Model,
    context: Context,
    streamOptions?: StreamOptions,
  ): Promise<AssistantMessage> {
    const models = config.fallback ? [primary, ...(options.fallbackModels ?? [])] : [primary];
    const signal = streamOptions?.signal;
    let attempts = 0;
    let lastError: unknown;
    let lastKind: ProviderErrorKind = 'unknown';

    for (let m = 0; m < models.length; m++) {
      const model = models[m]!;
      let retries = 0;
      let emptyRetries = 0;
      while (true) {
        attempts += 1;
        try {
          const reply = await attempt(call, model, context, streamOptions);
          if (reply.stopReason === 'error' && finishFailureKind(reply.errorMessage) === 'safety_block') {
            // Final by design: no retry, no fallback (see the module comment).
            options.onEvent?.({ type: 'refused', model: model.id, kind: 'safety_block', error: reply.errorMessage ?? '' });
          }
          return reply;
        } catch (error) {
          if (signal?.aborted) throw error;
          const info = classifyProviderError(error);
          lastError = error;
          lastKind = info.kind;
          const message = error instanceof Error ? error.message : String(error);
          const isEmpty = error instanceof EmptyResponseError;
          if (!info.retryable && !info.fallbackEligible) throw error;

          const budgetLeft = isEmpty ? emptyRetries < config.emptyReplyRetries : retries < config.maxRetries;
          const retryAfterTooLong = info.retryAfterMs !== undefined && info.retryAfterMs > config.maxRetryAfterMs;
          if (info.retryable && budgetLeft && !retryAfterTooLong) {
            const delayMs = isEmpty ? 0 : computeBackoffDelay(retries, config, info.retryAfterMs, options.random);
            if (isEmpty) emptyRetries += 1;
            else retries += 1;
            options.onEvent?.({ type: 'retry', model: model.id, attempt: attempts, kind: info.kind, delayMs, error: message });
            await wait(delayMs, signal);
            continue;
          }

          const nextIndex = info.fallbackEligible ? nextCandidateIndex(models, m, info.kind) : -1;
          const next = nextIndex >= 0 ? models[nextIndex] : undefined;
          if (next) {
            options.onEvent?.({ type: 'fallback', from: model.id, to: next.id, kind: info.kind, error: message });
            // Skip candidates that cannot succeed (see nextCandidateIndex); the loop adds one.
            m = nextIndex - 1;
            break;
          }
          // Out of empty-reply retries: hand the reply back so existing recovery paths run.
          if (isEmpty) return error.reply;
          options.onEvent?.({ type: 'give_up', model: model.id, kind: info.kind, error: message });
          // Non-retryable errors keep their original identity for upstream handlers,
          // except an exhausted quota or balance, which has nothing to handle and a polite message.
          if (!info.retryable && info.kind !== 'quota_exhausted' && info.kind !== 'billing') throw error;
          throw new ProviderRequestError(info.kind, attempts, error);
        }
      }
    }
    throw new ProviderRequestError(lastKind, attempts, lastError);
  }

  return {
    complete: (model, context, streamOptions) => run('complete', model, context, streamOptions),
    completeSimple: (model, context, streamOptions) => run('completeSimple', model, context, streamOptions),
  };
}
