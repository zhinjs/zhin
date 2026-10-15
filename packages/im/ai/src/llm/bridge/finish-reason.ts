/**
 * Map an AI SDK finish reason (plus the provider's raw reason) onto zhin's stop
 * reason, and turn refusals into a user-presentable error instead of a silent
 * empty reply. Gemini reports SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT
 * / SPII / IMAGE_SAFETY as `content-filter`, MAX_TOKENS as `length`,
 * MALFORMED_FUNCTION_CALL as `error`, and a blocked prompt only through
 * `providerMetadata.google.promptFeedback.blockReason`.
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

const CONTENT_FILTER_PREFIX = '模型因内容安全策略未生成回复';
const LENGTH_PREFIX = '模型输出达到长度上限，未生成回复';
const MALFORMED_PREFIX = '模型返回了无法解析的工具调用';
const FINISH_PREFIXES = [CONTENT_FILTER_PREFIX, LENGTH_PREFIX, MALFORMED_PREFIX];

/** True for messages produced here; they are safe to show to users as-is. */
export function isFinishFailureMessage(text: string): boolean {
  return FINISH_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function withReason(prefix: string, reason: string | undefined): string {
  return reason ? `${prefix}（${reason}）` : prefix;
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
    return { stopReason: 'error', errorMessage: withReason(CONTENT_FILTER_PREFIX, `prompt ${blocked}`) };
  }
  if (finishReason === 'content-filter') {
    return { stopReason: 'error', errorMessage: withReason(CONTENT_FILTER_PREFIX, rawFinishReason ?? 'content-filter') };
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
