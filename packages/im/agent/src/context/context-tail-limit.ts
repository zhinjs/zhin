import type { ZhinAgentConfig } from '../config/index.js';

/** 默认 agent 上下文 tail 条数（与 topic slidingWindowSize 解耦）。 */
export const DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT = 80;

/** 多 Bot 协作 Cell 推荐 tail（五角色群聊；过大易淹没模型）。 */
export const COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT = 32;

export function resolveContextTailMessageLimit(
  config: Pick<ZhinAgentConfig, 'contextTailMessageLimit' | 'slidingWindowSize'>,
): number {
  if (typeof config.contextTailMessageLimit === 'number' && config.contextTailMessageLimit > 0) {
    return config.contextTailMessageLimit;
  }
  // 历史误用 slidingWindowSize(=5) 作为 tail，协作场景会严重截断。
  return Math.max(config.slidingWindowSize ?? 5, DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT);
}
