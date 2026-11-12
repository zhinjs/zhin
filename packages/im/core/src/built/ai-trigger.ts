/**
 * AI trigger configuration contract (`ai.trigger`).
 *
 * The trigger decision itself lives in `@zhin.js/agent`; core only owns the config shape.
 */

/**
 * Ambient group engagement config. Declared structurally so core's published types do not
 * depend on `@zhin.js/ai`; `@zhin.js/ai` `AmbientEngagementConfig` is the documented source.
 */
export interface AmbientEngagementConfig {
  /** Groups that may be joined unprompted, as `platform:groupId`; `*` for every group. Default: none. */
  conversations?: string[];
  /** Outside a conversation, judge a group at most this often (default 30000). */
  judgeIntervalMs?: number;
  /** Wait for the group to be quiet this long before judging a burst of messages (default 4000). */
  quietMs?: number;
  /** Minimum gap between two unprompted interjections in a group (default 120000). */
  cooldownMs?: number;
  /** Unprompted interjections per group per rolling hour (default 3). */
  maxPerHour?: number;
  /** After the bot spoke, the group is in a conversation with it for this long (default 180000). */
  conversationWindowMs?: number;
  /** Judge confidence required to engage, 0..1 (default 0.7). */
  minConfidence?: number;
  /** `shadow` logs the judgment without replying (default `active`). */
  mode?: 'active' | 'shadow';
}

/** Scene-event wake config (#996); structurally identical to `@zhin.js/ai` `SceneEventWakeConfig`. */
export interface SceneEventWakeConfig {
  /** Groups/channels whose high-priority events may wake the bot, as `platform:sceneId`; `*` for all. */
  conversations?: string[];
  /** Coalesce window per scene in ms, clamped to 3000–5000 (default 4000). */
  coalesceMs?: number;
  /** Minimum gap between two wakes in one scene in ms (default 15000). */
  minIntervalMs?: number;
}

/**
 * AI 触发配置
 */
export interface AITriggerConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  
  /** 触发前缀列表（默认 ['#', 'AI:']） */
  prefixes?: string[];
  
  /** 是否响应 @ 机器人（默认 true） */
  respondToAt?: boolean;
  
  /** 是否响应私聊（默认 true） */
  respondToPrivate?: boolean;
  
  /** 触发关键词（可选） */
  keywords?: string[];
  
  /** 忽略的前缀（命令前缀，避免与命令冲突） */
  ignorePrefixes?: string[];
  
  /** 超时时间（毫秒，默认 60000） */
  timeout?: number;
  
  /** 思考中提示（可选） */
  thinkingMessage?: string;
  
  /** 入口层错误提示模板（可选；不配置时用聊天口吻，主人额外看到原因） */
  errorTemplate?: string;
  
  /** 群聊旁听：没人叫机器人时，由判断模型决定是否接话 */
  ambient?: AmbientEngagementConfig;

  /** 状态感知（#996）：高优先社交事件独立唤醒回合（debounce + 限频） */
  sceneEvents?: SceneEventWakeConfig;
}
