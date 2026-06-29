/**
 * AI Access Gate — 控制 LLM 回复路径是否对当前会话开放（平台 AIGC 合规等）
 */
import type { Message } from '../message.js';

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

export interface ResolvedAIAccessConfig {
  mode: AIAccessMode;
  users: string[];
  groups: string[];
  denyMessage: string;
}

export interface AIAccessResult {
  allowed: boolean;
  reason: string;
  /** 私聊拒绝时返回；群/频道拒绝为 undefined（静默） */
  replyMessage?: string;
}

export const DEFAULT_AI_ACCESS_DENY_MESSAGE = '当前会话未开放 AI 功能。';

const DEFAULT_MODE: AIAccessMode = 'open';

export function resolveAIAccessConfig(
  global: AIAccessConfig | undefined,
  endpointScope?: AIAccessScopeConfig,
): ResolvedAIAccessConfig {
  const base = global ?? {};
  const endpoint = endpointScope ?? {};
  return {
    mode: endpoint.mode ?? base.mode ?? DEFAULT_MODE,
    users: endpoint.users ?? base.users ?? [],
    groups: endpoint.groups ?? base.groups ?? [],
    denyMessage:
      endpoint.denyMessage ?? base.denyMessage ?? DEFAULT_AI_ACCESS_DENY_MESSAGE,
  };
}

function isWhitelisted(message: Message<any>, config: ResolvedAIAccessConfig): boolean {
  const userId = String(message.$sender?.id ?? '');
  if (userId && config.users.includes(userId)) return true;

  const scope = message.$channel?.type;
  if (scope === 'group' || scope === 'channel') {
    const channelId = String(message.$channel?.id ?? '');
    if (channelId && config.groups.includes(channelId)) return true;
  }

  return false;
}

function denyResult(message: Message<any>, config: ResolvedAIAccessConfig, reason: string): AIAccessResult {
  const scope = message.$channel?.type;
  const replyMessage = scope === 'private' ? config.denyMessage : undefined;
  return { allowed: false, reason, replyMessage };
}

/**
 * 判定当前消息是否允许进入 AI Handler（LLM 回复路径）。
 * 不影响命令、游戏等其它 Dispatcher 分支。
 */
export function checkAIAccess(
  message: Message<any>,
  globalConfig: AIAccessConfig | undefined,
  endpointScope?: AIAccessScopeConfig,
): AIAccessResult {
  const config = resolveAIAccessConfig(globalConfig, endpointScope);

  if (config.mode === 'open') {
    return { allowed: true, reason: 'mode: open' };
  }

  if (config.mode === 'closed') {
    return denyResult(message, config, 'mode: closed');
  }

  if (isWhitelisted(message, config)) {
    return { allowed: true, reason: 'whitelist: matched' };
  }

  return denyResult(message, config, 'whitelist: not matched');
}
