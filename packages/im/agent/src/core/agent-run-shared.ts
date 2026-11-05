/** agent-core-run 的装配小函数。 */
import type { TokenUsage, Usage } from '@zhin.js/ai';

export function tokenUsageToLegacy(usage: TokenUsage): Usage {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

