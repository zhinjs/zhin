/**
 * Compaction thresholds shared by the AgentMessage compaction path
 * (`agent-message-compaction.ts`) and its hosts.
 */

/** 默认上下文窗口大小（tokens） */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/** 自动压缩缓冲 token 数 */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** 连续压缩失败断路器上限 */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;
