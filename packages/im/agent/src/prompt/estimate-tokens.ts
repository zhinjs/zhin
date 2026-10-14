import { estimateTokens } from '@zhin.js/ai';

/**
 * Estimated tokens for a piece of prompt text: CJK ≈ 1 token per character,
 * other text ≈ 4 characters per token (the compaction estimator, minus its
 * per-message overhead).
 */
export function estimatePromptTokens(text: string): number {
  if (!text) return 0;
  return Math.max(0, estimateTokens({ role: 'system', content: text }) - 4);
}
