/** agent-core-run / agent-loop-standalone 共用的装配小函数。 */
import type { TokenUsage, Usage } from '@zhin.js/ai';

export function tokenUsageToLegacy(usage: TokenUsage): Usage {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

/** Preserve observed text and the failure reason for task consumers that only read text. */
export function formatTaskFailure(input: { content: string; errorMessage?: string }): string {
  const reason = input.errorMessage;
  if (!reason?.trim() || input.content.includes(reason)) return input.content;
  // Existing task summaries/artifact previews truncate the tail, so keep the cause visible first.
  return input.content ? `Error: ${reason}\n\n${input.content}` : `Error: ${reason}`;
}
