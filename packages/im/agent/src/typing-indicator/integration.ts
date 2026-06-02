/**
 * Typing Indicator 集成示例
 *
 * 展示如何在 ZhinAgent 中集成消息处理状态提示
 */

import type { Adapter, Bot } from '@zhin.js/core';

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
 * ICQQ Bot 接口扩展
 */
interface ICQQBot extends Bot {
  $addReaction?(messageId: string, emoji: string): Promise<string | null>;
  $removeReaction?(messageId: string, reactionId: string): Promise<void>;
}

/**
 * 创建 ICQQ 适配器
 *
 * 注意：实际使用时需要从 ICQQ 适配器实例获取 bot
 * 这里提供的是示例实现框架
 */
export function createICQQAdapterFromBot(bot: ICQQBot, outbound?: OutboundAdapter): ReactionTypingIndicatorAdapter {
  const addReaction = async (messageId: string, emoji: string): Promise<string | null> => {
    try {
      if (bot.$addReaction) {
        return await bot.$addReaction(messageId, emoji);
      }
      return null;
    } catch (error) {
      console.error('[ICQQ] Failed to add reaction:', error);
      return null;
    }
  };

  const removeReaction = async (messageId: string, reactionId: string): Promise<void> => {
    try {
      if (bot.$removeReaction) {
        await bot.$removeReaction(messageId, reactionId);
      }
    } catch (error) {
      console.error('[ICQQ] Failed to remove reaction:', error);
    }
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
        bot: bot.$id,
        content: [{ type: 'text', data: { text: content } }],
      };
      if (outbound) {
        return await outbound.sendMessage(sendOptions);
      }
      const typedBot = bot as BotWithEditing & { $sendMessage?(options: any): Promise<string | null> };
      return await typedBot.$sendMessage?.(sendOptions) ?? null;
    } catch (error) {
      console.error('[ICQQ] Failed to send message:', error);
      return null;
    }
  };

  const deleteMessage = async (messageId: string): Promise<void> => {
    try {
      await bot.$recallMessage(messageId);
    } catch (error) {
      console.error('[ICQQ] Failed to delete message:', error);
    }
  };

  return new ReactionTypingIndicatorAdapter(
    addReaction,
    removeReaction,
    sendMessage,
    deleteMessage,
  );
}

/**
 * 创建通用适配器
 */
export function createGenericAdapterFromBot(bot: Bot, platform: string, outbound?: OutboundAdapter): GenericTypingIndicatorAdapter {
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
        bot: bot.$id,
        content: [{ type: 'text', data: { text: content } }],
      };
      if (outbound) {
        return await outbound.sendMessage(sendOptions);
      }
      const typedBot = bot as BotWithEditing & { $sendMessage?(options: any): Promise<string | null> };
      return await typedBot.$sendMessage?.(sendOptions) ?? null;
    } catch (error) {
      console.error(`[${platform}] Failed to send message:`, error);
      return null;
    }
  };

  const deleteMessage = async (messageId: string): Promise<void> => {
    try {
      await bot.$recallMessage(messageId);
    } catch (error) {
      console.error(`[${platform}] Failed to delete message:`, error);
    }
  };

  return new GenericTypingIndicatorAdapter(platform, sendMessage, deleteMessage);
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
  /** Bot ID */
  botId: string;
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
 *   botId: '75318',
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
    botId: context.botId,
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
