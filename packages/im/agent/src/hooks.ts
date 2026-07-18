/**
 * AI Hooks — AI 生命周期事件钩子系统
 *
 * 借鉴 OpenClaw 的 Hooks 设计，提供可扩展的事件驱动钩子：
 *
 *   - message:received   — 收到消息时触发
 *   - message:sent       — 发送消息时触发
 *   - session:compact    — 会话压缩时触发
 *   - session:new        — 新建会话时触发
 *   - agent:bootstrap    — Agent 初始化时触发
 *   - agent:tool-call    — 工具调用时触发
 *
 * 钩子按注册顺序执行，错误不会中断其他钩子。
 */

import { emitAIHookBusEvent } from './plugin-ai-hook-bus.js';
import {
  registerModuleAIHook,
  unregisterModuleAIHook,
  clearModuleAIHooks,
  getRegisteredModuleAIHookKeys,
  runModuleAIHookHandlers,
} from './ai-hook-handlers.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 事件类型 */
export type AIHookEventType =
  | 'message'
  | 'session'
  | 'agent'
  | 'tool';

/** Hook 事件基础接口 */
export interface AIHookEvent {
  /** 事件类型 */
  type: AIHookEventType;
  /** 具体动作 */
  action: string;
  /** 会话标识 */
  sessionId?: string;
  /** 附加上下文 */
  context: Record<string, unknown>;
  /** 事件时间戳 */
  timestamp: Date;
  /** 钩子可以推送消息到这个数组 */
  messages: string[];
}

/** 消息接收事件 */
export interface MessageReceivedEvent extends AIHookEvent {
  type: 'message';
  action: 'received';
  context: {
    from: string;
    content: string;
    platform: string;
    channelId?: string;
    messageId?: string;
  };
}

/** 消息发送事件 */
export interface MessageSentEvent extends AIHookEvent {
  type: 'message';
  action: 'sent';
  context: {
    to: string;
    content: string;
    success: boolean;
    error?: string;
    platform: string;
  };
}

/** 会话压缩事件 */
export interface SessionCompactEvent extends AIHookEvent {
  type: 'session';
  action: 'compact';
  context: {
    compactedCount: number;
    savedTokens: number;
    summary: string;
  };
}

/** 会话新建事件 */
export interface SessionNewEvent extends AIHookEvent {
  type: 'session';
  action: 'new';
  context: {
    previousSessionId?: string;
  };
}

/** Agent 初始化事件 */
export interface AgentBootstrapEvent extends AIHookEvent {
  type: 'agent';
  action: 'bootstrap';
  context: {
    workspaceDir: string;
    toolCount: number;
    skillCount: number;
    bootstrapFiles: string[];
  };
}

/** Agent 系统提示平台段解析（sections 可变，供 hook 追加） */
export interface AgentPromptHookEvent extends AIHookEvent {
  type: 'agent';
  action: 'prompt';
  context: {
    slot: import('@zhin.js/core').AgentPromptSlot;
    commMessage: import('@zhin.js/core').Message<any>;
    userMessagePreview?: string;
    deferred?: import('@zhin.js/core').AgentPromptBuildContext['deferred'];
    sections: import('@zhin.js/core').AgentPromptSection[];
  };
}

/** 工具调用事件 */
export interface ToolCallEvent extends AIHookEvent {
  type: 'tool';
  action: 'call';
  context: {
    toolName: string;
    args: Record<string, unknown>;
    result?: string;
    durationMs?: number;
    success: boolean;
    error?: string;
  };
}

/** Hook 处理函数 */
export type AIHookHandler = (event: AIHookEvent) => Promise<void> | void;

// ============================================================================
// Hook 管理器（委托共享 module registry，供 Runtime + legacy 共用）
// ============================================================================

/**
 * 注册 Hook 处理函数
 *
 * @param eventKey - 事件类型（如 'message'）或具体动作（如 'message:received'）
 * @param handler - 处理函数
 *
 * @example
 * ```ts
 * // 监听所有消息事件
 * registerAIHook('message', async (event) => {
 *   console.log('消息事件:', event.action);
 * });
 *
 * // 只监听消息接收
 * registerAIHook('message:received', async (event) => {
 *   console.log('收到消息:', event.context.content);
 * });
 * ```
 */
export function registerAIHook(eventKey: string, handler: AIHookHandler): () => void {
  return registerModuleAIHook(eventKey, handler as import('./orchestrator/types.js').AIHookHandler);
}

/**
 * 注销 Hook 处理函数
 */
export function unregisterAIHook(eventKey: string, handler: AIHookHandler): void {
  unregisterModuleAIHook(eventKey, handler as import('./orchestrator/types.js').AIHookHandler);
}

/**
 * 清除所有 Hook（测试用）
 */
export function clearAIHooks(): void {
  clearModuleAIHooks();
}

/**
 * 获取已注册的事件 key 列表（调试用）
 */
export function getRegisteredAIHookKeys(): string[] {
  return getRegisteredModuleAIHookKeys();
}

/**
 * 触发 Hook 事件
 *
 * 扇出到 Runtime bus + `registerAIHook` handlers +（若有）host Plugin。
 */
export async function triggerAIHook(event: AIHookEvent): Promise<void> {
  emitAIHookBusEvent(event as import('./orchestrator/types.js').AIHookEvent, 'ai-hook');
}

export { runModuleAIHookHandlers };

/**
 * 创建 Hook 事件（辅助函数）
 */
export function createAIHookEvent(
  type: AIHookEventType,
  action: string,
  sessionId?: string,
  context: Record<string, unknown> = {},
): AIHookEvent {
  return {
    type,
    action,
    sessionId,
    context,
    timestamp: new Date(),
    messages: [],
  };
}
