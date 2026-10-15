import type { AssistantMessage } from '../types/agent-message.js';

/** assistant 消息的文本视图（无文本时回退 thinking 拼接）。 */
export function assistantText(message: AssistantMessage): string {
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (text.trim()) return text;
  const hasToolCalls = message.content.some((b) => b.type === 'toolCall');
  if (hasToolCalls) return text;
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('');
}

/** Raised when a text completion finished without a usable answer (safety block, length, ...). */
export class CompletionFailureError extends Error {
  readonly stopReason: AssistantMessage['stopReason'];

  constructor(message: AssistantMessage) {
    super(message.errorMessage ?? `Completion failed (${message.stopReason})`);
    this.name = 'CompletionFailureError';
    this.stopReason = message.stopReason;
  }
}

/**
 * Answer text of a plain completion (summaries, compaction). Unlike {@link assistantText}
 * it never falls back to thinking: reasoning is not a summary. A reply that ended with a
 * user-presentable `errorMessage` (content filter, length without text) throws
 * {@link CompletionFailureError} so callers keep their failure handling.
 */
export function assistantAnswerText(message: AssistantMessage): string {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new CompletionFailureError(message);
  }
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
