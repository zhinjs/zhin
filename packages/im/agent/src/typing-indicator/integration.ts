/**
 * Typing Indicator 集成示例
 *
 * 展示如何在 ZhinAgent 中集成消息处理状态提示
 */

import { getLogger } from '@zhin.js/logger';
import type { Adapter, Endpoint } from '@zhin.js/core';
import type { MessageRef } from '@zhin.js/im-contract';

const logger = getLogger('TypingIndicator');

type OutboundAdapter = Pick<Adapter, 'sendMessage'>;
import {
  TypingIndicatorManager,
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  type TypingIndicatorOptions,
  type TypingIndicatorConfig,
} from './index.js';
import type { BotWithEditing } from './adapter-integration.js';

// ── ZhinAgent 集成 ────────────────────────────────────────────────────

export interface ZhinAgentTypingConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 默认提示类型 */
  defaultType: 'reaction' | 'message' | 'typing' | 'none';
  /** 默认表情（reaction 类型） */
  defaultEmoji: string;
  /** 默认消息（message 类型） */
  defaultMessage: string;
  /** 是否自动移除 */
  autoRemove: boolean;
  /** 自动移除延迟（毫秒） */
  removeDelay: number;
  /** 平台特定配置 */
  platformConfigs?: Record<string, Partial<TypingIndicatorConfig>>;
}

const DEFAULT_TYPING_CONFIG: ZhinAgentTypingConfig = {
  enabled: true,
  defaultType: 'reaction',
  defaultEmoji: '⏳',
  defaultMessage: '正在处理中...',
  autoRemove: true,
  removeDelay: 5000,
};

/**
 * 为 ZhinAgent 创建 Typing Indicator 管理器
 */
export function createTypingIndicatorManagerForZhinAgent(
  plugin: Plugin,
  config: Partial<ZhinAgentTypingConfig> = {},
): TypingIndicatorManager {
  const mergedConfig = { ...DEFAULT_TYPING_CONFIG, ...config };

  const manager = new TypingIndicatorManager({
    type: mergedConfig.defaultType,
    emoji: mergedConfig.defaultEmoji,
    message: mergedConfig.defaultMessage,
    autoRemove: mergedConfig.autoRemove,
    removeDelay: mergedConfig.removeDelay,
  });

  // 注册 ICQQ 适配器（如果存在）
  // 注意：实际使用时需要从适配器实例获取 bot
  // 这里提供的是示例实现

  return manager;
}

/**
 * ICQQ Endpoint 接口扩展（legacy `$` 控制面见 im-contract 的 SSOT 声明）
 */
type ICQQBot = Endpoint;

/**
 * 创建 ICQQ 适配器
 *
 * 注意：实际使用时需要从 ICQQ 适配器实例获取 bot
 * 这里提供的是示例实现框架
 */
export function createICQQAdapterFromBot(endpoint: ICQQBot, outbound?: OutboundAdapter): ReactionTypingIndicatorAdapter {
  const messages = new Map<string, MessageRef>();
  const addReaction = async (
    messageId: string,
    emoji: string,
    options: TypingIndicatorOptions,
  ): Promise<string | null> => {
    try {
      const message = messageRef(endpoint, 'icqq', options, messageId);
      messages.set(messageId, message);
      if (endpoint.control?.addReaction) {
        return await endpoint.control.addReaction(message, emoji);
      }
      return null;
    } catch (error) {
      logger.error('[ICQQ] Failed to add reaction:', error);
      return null;
    }
  };

  const removeReaction = async (messageId: string, reactionId: string): Promise<void> => {
    const message = messages.get(messageId);
    if (!message || !endpoint.control?.removeReaction) return;
    void Promise.resolve(endpoint.control.removeReaction(message, reactionId)).catch((error) => {
      logger.warn('[ICQQ] Failed to remove reaction:', error);
    });
  };

  const sendMessage = async (
    options: TypingIndicatorOptions,
    content: string,
  ): Promise<string | null> => {
    try {
      const isGroup = options.sceneType === 'group' || options.sceneType === 'channel';
      const id = isGroup
        ? (options.groupId ?? options.sessionId?.split(':')[1] ?? '')
        : (options.userId ?? options.sessionId?.split(':').pop() ?? '');
      const sendOptions = {
        type: (isGroup ? 'group' : 'private') as 'private' | 'group',
        id,
        context: 'icqq',
        endpoint: endpoint.$id,
        content: [{ type: 'text', data: { text: content } }],
      };
      if (outbound) {
        const messageId = await outbound.sendMessage(sendOptions);
        if (messageId) messages.set(messageId, messageRef(endpoint, 'icqq', options, messageId));
        return messageId;
      }
      const typedBot = endpoint as BotWithEditing & { $sendMessage?(options: any): Promise<string | null> };
      const messageId = await typedBot.$sendMessage?.(sendOptions) ?? null;
      if (messageId) messages.set(messageId, messageRef(endpoint, 'icqq', options, messageId));
      return messageId;
    } catch (error) {
      logger.error('[ICQQ] Failed to send message:', error);
      return null;
    }
  };

  const deleteMessage = async (messageId: string): Promise<void> => {
    try {
      const message = messages.get(messageId);
      if (message) await endpoint.control?.recall?.(message);
    } catch (error) {
      logger.error('[ICQQ] Failed to delete message:', error);
    }
  };

  return new ReactionTypingIndicatorAdapter(
    'icqq',
    addReaction,
    removeReaction,
    sendMessage,
    deleteMessage,
  );
}

/**
 * 创建通用适配器
 */
export function createGenericAdapterFromBot(endpoint: Endpoint, platform: string, outbound?: OutboundAdapter): GenericTypingIndicatorAdapter {
  const messages = new Map<string, MessageRef>();
  const sendMessage = async (
    options: TypingIndicatorOptions,
    content: string,
  ): Promise<string | null> => {
    try {
      const isGroup = options.sceneType === 'group' || options.sceneType === 'channel';
      const id = isGroup
        ? (options.groupId ?? options.sessionId?.split(':')[1] ?? '')
        : (options.userId ?? options.sessionId?.split(':').pop() ?? '');
      const sendOptions = {
        type: (isGroup ? 'group' : 'private') as 'private' | 'group',
        id,
        context: platform,
        endpoint: endpoint.$id,
        content: [{ type: 'text', data: { text: content } }],
      };
      if (outbound) {
        const messageId = await outbound.sendMessage(sendOptions);
        if (messageId) messages.set(messageId, messageRef(endpoint, platform, options, messageId));
        return messageId;
      }
      const typedBot = endpoint as BotWithEditing & { $sendMessage?(options: any): Promise<string | null> };
      const messageId = await typedBot.$sendMessage?.(sendOptions) ?? null;
      if (messageId) messages.set(messageId, messageRef(endpoint, platform, options, messageId));
      return messageId;
    } catch (error) {
      logger.error(`[${platform}] Failed to send message:`, error);
      return null;
    }
  };

  const deleteMessage = async (messageId: string): Promise<void> => {
    try {
      const message = messages.get(messageId);
      if (message) await endpoint.control?.recall?.(message);
    } catch (error) {
      logger.error(`[${platform}] Failed to delete message:`, error);
    }
  };

  return new GenericTypingIndicatorAdapter(platform, sendMessage, deleteMessage);
}

function messageRef(
  endpoint: Endpoint,
  platform: string,
  options: TypingIndicatorOptions,
  id: string,
): MessageRef {
  const group = options.sceneType === 'group' || options.sceneType === 'channel';
  const conversationId = group
    ? (options.groupId ?? options.sessionId)
    : (options.userId ?? options.sessionId);
  if (!conversationId) throw new TypeError('Typing indicator requires a conversation identity');
  return {
    conversation: {
      endpoint: { id: endpoint.$id, adapter: platform },
      kind: options.sceneType,
      id: conversationId,
    },
    id,
  };
}

// ── ZhinAgent 处理流程集成 ────────────────────────────────────────────

export interface AgentProcessContext {
  /** 消息 ID */
  messageId?: string;
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 群组 ID */
  groupId?: string;
  /** 平台 */
  platform: string;
  /** Endpoint ID */
  endpointKey: string;
  /** 场景类型 */
  sceneType: 'private' | 'group' | 'channel';
}

/**
 * 在 Agent 处理过程中使用 Typing Indicator
 *
 * 使用示例：
 * ```typescript
 * const manager = createTypingIndicatorManagerForZhinAgent(plugin);
 *
 * // 开始处理时
 * const indicator = await manager.start({
 *   platform: 'icqq',
 *   endpointKey: '75318',
 *   sessionId: 'private:liuchunlang',
 *   messageId: '123456',
 *   sceneType: 'private',
 * }, {
 *   type: 'reaction',
 *   emoji: '⏳',
 * });
 *
 * // 处理完成后
 * await indicator.stop();
 * ```
 */
export async function withTypingIndicator<T>(
  manager: TypingIndicatorManager,
  context: AgentProcessContext,
  config: Partial<TypingIndicatorConfig>,
  fn: () => Promise<T>,
): Promise<T> {
  const options: TypingIndicatorOptions = {
    messageId: context.messageId,
    sessionId: context.sessionId,
    userId: context.userId,
    groupId: context.groupId,
    platform: context.platform,
    endpointKey: context.endpointKey,
    sceneType: context.sceneType,
  };

  // 开始提示
  const indicator = await manager.start(options, config);

  try {
    // 执行实际处理
    const result = await fn();
    return result;
  } finally {
    // 停止提示
    await indicator.stop();
  }
}

// ── 配置解析 ──────────────────────────────────────────────────────────

/**
 * 从平台配置解析 Typing Indicator 配置
 */
export function resolveTypingIndicatorConfig(
  platform: string,
  platformConfig?: Record<string, unknown>,
): Partial<TypingIndicatorConfig> {
  const defaultConfigs: Record<string, Partial<TypingIndicatorConfig>> = {
    icqq: {
      type: 'reaction',
      emoji: '⏳',
      autoRemove: true,
    },
    qq: {
      type: 'reaction',
      emoji: '⏳',
      autoRemove: true,
    },
    wechat: {
      type: 'message',
      message: '正在思考...',
      autoRemove: true,
      removeDelay: 3000,
    },
    telegram: {
      type: 'typing',
      autoRemove: true,
    },
    'weixin-ilink': {
      type: 'typing',
      autoRemove: true,
      platformConfig: { keepaliveIntervalMs: 5_000 },
    },
    discord: {
      type: 'typing',
      autoRemove: true,
    },
  };

  const defaultConfig = defaultConfigs[platform] || {
    type: 'message',
    message: '正在处理中...',
    autoRemove: true,
  };

  // 合并平台特定配置
  if (platformConfig) {
    return { ...defaultConfig, ...platformConfig };
  }

  return defaultConfig;
}
