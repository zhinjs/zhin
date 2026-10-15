/**
 * Map an AI SDK finish reason (plus the provider's raw reason) onto zhin's stop
 * reason, and turn refusals into a user-presentable error instead of a silent
 * empty reply. Gemini reports SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT
 * / SPII / IMAGE_SAFETY as `content-filter`, MAX_TOKENS as `length`,
 * MALFORMED_FUNCTION_CALL as `error`, and a blocked prompt only through
 * `providerMetadata.google.promptFeedback.blockReason`.
 *
 * The resilience layer reads {@link finishFailureKind} to decide what to do with
 * such a reply: a safety block is final (no retry, no fallback), a malformed
 * function call may be re-asked when a model-harness preset opts in.
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

/** Why a reply carries no usable content; see {@link finishFailureKind}. */
export type FinishFailureKind = 'safety_block' | 'length' | 'malformed_tool_call';

const FINISH_PREFIXES: ReadonlyArray<readonly [string, FinishFailureKind]> = [
  [CONTENT_FILTER_PREFIX, 'safety_block'],
  [LENGTH_PREFIX, 'length'],
  [MALFORMED_PREFIX, 'malformed_tool_call'],
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
    return { stopReason: 'error', errorMessage: withReason(MALFORMED_PREFIX, rawFinishReason) };
  }
  return { stopReason: 'stop' };
}
