/**
 * Chat-history table models and the `ai.context` configuration shape.
 *
 * The scene-level ContextManager that used to live here had no production caller;
 * history is loaded through ContextRepository.
 */

// ============================================================================
// 数据库模型定义
// ============================================================================

/**
 * 聊天消息记录模型定义
 */
export const CHAT_MESSAGE_MODEL = {
  message_id: { type: 'text' as const, default: '' },
  platform: { type: 'text' as const, nullable: false },
  endpoint_id: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  scene_type: { type: 'text' as const, nullable: false },
  scene_name: { type: 'text' as const, default: '' },
  sender_id: { type: 'text' as const, nullable: false },
  sender_name: { type: 'text' as const, default: '' },
  sender_role: { type: 'text' as const, default: 'user' },
  direction: { type: 'text' as const, nullable: false },
  message: { type: 'text' as const, nullable: false },
  time: { type: 'bigint' as const, nullable: false },
};

/**
 * 上下文总结模型定义
 */
export const CONTEXT_SUMMARY_MODEL = {
  scene_id: { type: 'text' as const, nullable: false },      // 场景ID
  summary: { type: 'text' as const, nullable: false },       // 总结内容
  message_count: { type: 'integer' as const, default: 0 },   // 包含的消息数量
  start_time: { type: 'bigint' as const, default: 0 },      // 总结的起始时间
  end_time: { type: 'bigint' as const, default: 0 },        // 总结的结束时间
  created_at: { type: 'bigint' as const, default: 0 },      // 创建时间
};

/**
 * 上下文配置
 */
export interface ContextConfig {
  /** 是否启用上下文管理（默认 true） */
  enabled?: boolean;
  /** 读取的最近消息数量（默认 100） */
  maxRecentMessages?: number;
  /** 每轮历史 token 预算（ADR 0043）；由 Agent 运行时读取 */
  historyTokens?: number | string | { group?: number | string; private?: number | string; masterPrivate?: number | string };
  /** 触发总结的消息数量阈值（默认 50） */
  summaryThreshold?: number;
  /** 总结后保留的消息数量（默认 10） */
  keepAfterSummary?: number;
  /** 上下文最大 token 估算（默认 4000） */
  maxContextTokens?: number;
  /** 总结提示词 */
  summaryPrompt?: string;
}
