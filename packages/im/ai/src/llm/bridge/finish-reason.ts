/**
 * Map an AI SDK finish reason (plus the provider's raw reason) onto zhin's stop
 * reason, and turn refusals into a user-presentable error instead of a silent
 * empty reply. Gemini reports SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT
 * / SPII / IMAGE_SAFETY as `content-filter`, MAX_TOKENS as `length`,
 * MALFORMED_FUNCTION_CALL as `error`, and a blocked prompt only through
 * `providerMetadata.google.promptFeedback.blockReason`. DeepSeek reports
 * `insufficient_system_resource` (its inference cluster dropped the request) as
 * `error` too; that is a transient provider failure, not a broken tool call.
 *
 * The resilience layer reads {@link finishFailureKind} to decide what to do with
 * such a reply: a safety block is final (no retry, no fallback), a malformed
 * function call may be re-asked when a model-harness preset opts in, and a
 * provider-side error finish is retried like a 5xx.
 */
import type { AssistantStopReason } from '../types/agent-message.js';

export interface FinishInput {
  readonly finishReason: string | undefined;
  readonly rawFinishReason?: string | undefined;
  readonly providerMetadata?: unknown;
  readonly hasText: boolean;
  readonly hasToolCalls: boolean;
}

export interface FinishOutcome {
  readonly stopReason: AssistantStopReason;
  /** Set when the model produced nothing usable for a reason the user should see. */
  readonly errorMessage?: string;
}

/** Polite, user-facing refusal text; the provider reason code follows in brackets for operators. */
const CONTENT_FILTER_PREFIX = '抱歉，这条内容触发了模型的内容安全策略，没能生成回复';
const CONTENT_FILTER_HINT = '，换个说法再试试吧';
/** The safety-block refusal without a reason code. */
export const SAFETY_BLOCK_TEXT = `${CONTENT_FILTER_PREFIX}${CONTENT_FILTER_HINT}`;
const LENGTH_PREFIX = '模型输出达到长度上限，未生成回复';
const MALFORMED_PREFIX = '模型返回了无法解析的工具调用';
const PROVIDER_ERROR_PREFIX = '模型服务中途出错，未生成回复';

/** Raw `error` finish reasons that mean the model emitted a tool call the provider could not parse. */
const MALFORMED_RAW_REASONS = new Set(['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL']);

/** Why a reply carries no usable content; see {@link finishFailureKind}. */
export type FinishFailureKind = 'safety_block' | 'length' | 'malformed_tool_call' | 'provider_error';

const FINISH_PREFIXES: ReadonlyArray<readonly [string, FinishFailureKind]> = [
  [CONTENT_FILTER_PREFIX, 'safety_block'],
  [LENGTH_PREFIX, 'length'],
  [MALFORMED_PREFIX, 'malformed_tool_call'],
  [PROVIDER_ERROR_PREFIX, 'provider_error'],
];

/** The failure kind of an `errorMessage` produced by {@link resolveFinish}, if it is one. */
export function finishFailureKind(text: string | undefined): FinishFailureKind | undefined {
  if (!text) return undefined;
  return FINISH_PREFIXES.find(([prefix]) => text.startsWith(prefix))?.[1];
}

/** True for messages produced here; they are safe to show to users as-is. */
export function isFinishFailureMessage(text: string): boolean {
  return finishFailureKind(text) !== undefined;
}

function withReason(prefix: string, reason: string | undefined): string {
  return reason ? `${prefix}（${reason}）` : prefix;
}

function safetyBlockMessage(reason: string): string {
  return `${withReason(CONTENT_FILTER_PREFIX, reason)}${CONTENT_FILTER_HINT}`;
}

/** `promptFeedback.blockReason` when Gemini refused the prompt itself. */
export function promptBlockReason(providerMetadata: unknown): string | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined;
  for (const key of ['google', 'vertex']) {
    const feedback = (providerMetadata as Record<string, { promptFeedback?: { blockReason?: unknown } | null } | undefined>)[key]?.promptFeedback;
    const reason = feedback?.blockReason;
    if (typeof reason === 'string' && reason && reason !== 'BLOCKED_REASON_UNSPECIFIED') return reason;
  }
  return undefined;
}

export function resolveFinish(input: FinishInput): FinishOutcome {
  const { finishReason, rawFinishReason, hasText, hasToolCalls } = input;
  if (hasToolCalls || finishReason === 'tool-calls') return { stopReason: 'toolCalls' };
  const blocked = promptBlockReason(input.providerMetadata);
  if (blocked && !hasText) {
    return { stopReason: 'error', errorMessage: safetyBlockMessage(`prompt ${blocked}`) };
  }
  if (finishReason === 'content-filter') {
    return { stopReason: 'error', errorMessage: safetyBlockMessage(rawFinishReason ?? 'content-filter') };
  }
  if (finishReason === 'length') {
    return hasText
      ? { stopReason: 'length' }
      : { stopReason: 'error', errorMessage: withReason(LENGTH_PREFIX, rawFinishReason ?? 'length') };
  }
  if (finishReason === 'error' && !hasText) {
    // Only Gemini's tool-call parse failures are malformed calls; any other `error`
    // finish (DeepSeek insufficient_system_resource, an unnamed provider failure) is
    // the provider's fault and worth retrying.
    const malformed = rawFinishReason !== undefined && MALFORMED_RAW_REASONS.has(rawFinishReason);
    return {
      stopReason: 'error',
      errorMessage: withReason(malformed ? MALFORMED_PREFIX : PROVIDER_ERROR_PREFIX, rawFinishReason),
    };
  }
  return { stopReason: 'stop' };
}
