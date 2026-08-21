import type { ZhinAgentConfig } from '../config/index.js';

/** 默认 Agent 上下文 tail 条数。 */
export const DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT = 80;

export function resolveContextTailMessageLimit(
  config: Pick<ZhinAgentConfig, 'contextTailMessageLimit'>,
): number {
  if (typeof config.contextTailMessageLimit === 'number' && config.contextTailMessageLimit > 0) {
    return config.contextTailMessageLimit;
  }
  return DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT;
}
