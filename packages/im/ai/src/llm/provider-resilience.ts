/**
 * Provider resilience: error classification, bounded retry with backoff, per-attempt
 * timeout, and model fallback for a single LLM completion.
 *
 * The wrapper decorates an existing {@link LlmCompletionPort}; it never replays tool
 * side effects because it only re-issues one completion request. Errors that are not
 * worth retrying (auth, bad request, context overflow, caller abort) are re-thrown
 * unchanged so existing handlers such as context-overflow compaction keep working.
 */
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
  | Readonly<{ type: 'give_up'; model: string; kind: ProviderErrorKind; error: string }>;

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

/** True when `text` is a {@link ProviderRequestError} message that is safe to show users as-is. */
export function isProviderFailureMessage(text: string): boolean {
  return PROVIDER_FAILURE_MESSAGES.has(text);
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

const CONTEXT_OVERFLOW_PATTERN = /context[_ ]length|context window|maximum context|too many tokens|prompt is too long/i;

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
  const rec = record(inner) ?? {};
  const name = typeof rec.name === 'string' ? rec.name : '';
  const message = typeof rec.message === 'string' ? rec.message : String(inner ?? '');
  const status = statusOf(rec);
  const retryAfterMs = parseRetryAfterMs(headerValue(rec.responseHeaders, 'retry-after'));

  if (name === 'AbortError') return { kind: 'aborted', retryable: false, fallbackEligible: false };
  if (name === 'TimeoutError') return { kind: 'timeout', retryable: true, fallbackEligible: true };
  if (CONTEXT_OVERFLOW_PATTERN.test(message)) {
    return { kind: 'context_overflow', retryable: false, fallbackEligible: false, status };
  }
  if (status === 429) return { kind: 'rate_limit', retryable: true, fallbackEligible: true, status, retryAfterMs };
  if (status === 408) return { kind: 'timeout', retryable: true, fallbackEligible: true, status };
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false, fallbackEligible: false, status };
  if (status !== undefined && status >= 500) {
    return { kind: 'server', retryable: true, fallbackEligible: true, status, retryAfterMs };
  }
  // Model-specific rejections (unknown model, unsupported parameter) may succeed elsewhere.
  if (status !== undefined && status >= 400) return { kind: 'bad_request', retryable: false, fallbackEligible: true, status };

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

/** Detect a reply that carries nothing usable, or a tool call with no name. */
function inspectReply(message: AssistantMessage): EmptyResponseError | undefined {
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
          return await attempt(call, model, context, streamOptions);
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

          const next = info.fallbackEligible ? models[m + 1] : undefined;
          if (next) {
            options.onEvent?.({ type: 'fallback', from: model.id, to: next.id, kind: info.kind, error: message });
            break;
          }
          // Out of empty-reply retries: hand the reply back so existing recovery paths run.
          if (isEmpty) return error.reply;
          options.onEvent?.({ type: 'give_up', model: model.id, kind: info.kind, error: message });
          // Non-retryable errors keep their original identity for upstream handlers.
          if (!info.retryable) throw error;
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
