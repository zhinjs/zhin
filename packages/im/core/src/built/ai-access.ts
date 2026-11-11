/**
 * AI Access Gate config — 控制 LLM 回复路径是否对当前会话开放（平台 AIGC 合规等）。
 * The gate itself lives in `@zhin.js/agent`; core only owns the config shape.
 */
export type AIAccessMode = 'open' | 'closed' | 'whitelist';

/** Endpoint 或全局 ai.access 配置块 */
export interface AIAccessScopeConfig {
  mode?: AIAccessMode;
  /** 允许触发 AI 的 sender.id */
  users?: string[];
  /** 允许触发 AI 的 group/channel id */
  groups?: string[];
  /** 私聊拒绝时的回复文案 */
  denyMessage?: string;
}

/** 全局 ai.access 配置（与 AIAccessScopeConfig 同形） */
export type AIAccessConfig = AIAccessScopeConfig;
