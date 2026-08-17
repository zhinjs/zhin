import type { ZhinAgentConfig } from '../config/index.js';

/** 默认 agent 上下文 tail 条数（与 topic slidingWindowSize 解耦）。 */
export const DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT = 80;

export function resolveContextTailMessageLimit(
  config: Pick<ZhinAgentConfig, 'contextTailMessageLimit' | 'slidingWindowSize'>,
): number {
  if (typeof config.contextTailMessageLimit === 'number' && config.contextTailMessageLimit > 0) {
    return config.contextTailMessageLimit;
  }
  // Historical configurations misused slidingWindowSize(=5) as the context tail.
  return Math.max(config.slidingWindowSize ?? 5, DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT);
}
