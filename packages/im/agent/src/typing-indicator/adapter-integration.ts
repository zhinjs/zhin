/**
 * 通用适配器 Typing Indicator 集成模块
 *
 * 为所有适配器提供统一的 Typing Indicator 集成接口，
 * 支持自动初始化和配置管理。
 */

import type { Adapter, Bot, SendOptions } from '@zhin.js/core';
import {
  TypingIndicatorManager,
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  type TypingIndicatorOptions,
  type TypingIndicatorConfig,
  type TypingIndicator,
} from './index.js';

/**
 * 平台 Bot 可能具备的扩展消息编辑能力
 */
interface MessageEditableBot {
  $editMessage?(messageId: string, content: string): Promise<void>;
  $updateMessage?(messageId: string, content: string): Promise<void>;
}

export type BotWithEditing = Bot & Partial<MessageEditableBot>;

/** 出站发送：优先 Adapter.sendMessage（走 before.sendMessage 链） */
type OutboundAdapter = Pick<Adapter, 'sendMessage'>;

function resolveTypingSendTarget(options: TypingIndicatorOptions): {
  type: 'private' | 'group';
  id: string;
} {
  if (
    (options.sceneType === 'group' || options.sceneType === 'channel') &&
    options.groupId
  ) {
    return { type: 'group', id: options.groupId };
  }
  if (options.userId) {
    return { type: 'private', id: options.userId };
  }
  const parts = (options.sessionId ?? '').split(':').filter((p) => p.length > 0);
  if (parts.length >= 3) {
    return { type: 'group', id: parts[1]! };
  }
  if (parts.length >= 2) {
    return { type: 'private', id: parts[parts.length - 1]! };
  }
  return { type: 'private', id: options.sessionId ?? '' };
}

function createOutboundSendMessage(
  bot: Bot,
  platform: string,
  outbound?: OutboundAdapter,
): (options: TypingIndicatorOptions, content: string) => Promise<string | null> {
  return async (options: TypingIndicatorOptions, content: string) => {
    try {
      const { type, id } = resolveTypingSendTarget(options);
      const sendOptions: SendOptions = {
        type,
        id,
        context: platform,
        bot: bot.$id,
        content: [{ type: 'text' as const, data: { text: content } }],
      };
      if (outbound) {
        return await outbound.sendMessage(sendOptions);
      }
      const typedBot = bot as BotWithEditing & {
        $sendMessage?(options: SendOptions): Promise<string | null>;
      };
      return await typedBot.$sendMessage?.(sendOptions) ?? null;
    } catch (error) {
      console.error(`[${platform}] Failed to send message:`, error);
      return null;
    }
  };
}

// ── 适配器 Typing Indicator 配置 ─────────────────────────────────────

export interface AdapterTypingIndicatorConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 默认表情（默认 '⏳'） */
  defaultEmoji?: string;
  /** 是否在完成后自动移除（默认 true） */
  autoRemove?: boolean;
  /** 自动移除延迟，毫秒（默认 5000） */
  removeDelay?: number;
  /** 私聊配置 */
  privateConfig?: Partial<TypingIndicatorConfig>;
  /** 群聊配置 */
  groupConfig?: Partial<TypingIndicatorConfig>;
  /** 平台特定配置 */
  platformConfig?: Record<string, Partial<TypingIndicatorConfig>>;
}

// ── 平台特性定义 ──────────────────────────────────────────────────────

export interface PlatformFeatures {
  /** 平台名称 */
  platform: string;
  /** 是否支持消息回应（reaction） */
  supportsReaction: boolean;
  /** 是否支持消息编辑 */
  supportsEdit: boolean;
  /** 是否支持消息删除 */
  supportsDelete: boolean;
  /** 是否支持输入状态 */
  supportsTyping: boolean;
  /** 默认提示类型 */
  defaultType: 'reaction' | 'message' | 'typing' | 'none';
}

// ── 预定义平台特性 ────────────────────────────────────────────────────

export const PLATFORM_FEATURES: Record<string, PlatformFeatures> = {
  icqq: {
    platform: 'icqq',
    supportsReaction: true,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'reaction',
  },
  telegram: {
    platform: 'telegram',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  discord: {
    platform: 'discord',
    supportsReaction: true,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  kook: {
    platform: 'kook',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  slack: {
    platform: 'slack',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  lark: {
    platform: 'lark',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  dingtalk: {
    platform: 'dingtalk',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'message',
  },
  qq: {
    platform: 'qq',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  onebot11: {
    platform: 'onebot11',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  onebot12: {
    platform: 'onebot12',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  napcat: {
    platform: 'napcat',
    supportsReaction: true,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'reaction',
  },
  github: {
    platform: 'github',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'message',
  },
  satori: {
    platform: 'satori',
    supportsReaction: false,
    supportsEdit: true,
    supportsDelete: true,
    supportsTyping: true,
    defaultType: 'typing',
  },
  email: {
    platform: 'email',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'none',
  },
  'wechat-mp': {
    platform: 'wechat-mp',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: false,
    supportsTyping: false,
    defaultType: 'message',
  },
  milky: {
    platform: 'milky',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
  sandbox: {
    platform: 'sandbox',
    supportsReaction: false,
    supportsEdit: false,
    supportsDelete: true,
    supportsTyping: false,
    defaultType: 'message',
  },
};

// ── 通用 Bot 接口扩展 ────────────────────────────────────────────────

/** 平台适配器自管的 Typing Indicator（如 ICQQ），与 agent 内置 TypingIndicatorManager 区分 */
export interface PlatformTypingIndicatorManager {
  start(options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  }): Promise<unknown>;
  stop(options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
  }): Promise<void>;
}

export type BotTypingIndicatorManager = TypingIndicatorManager | PlatformTypingIndicatorManager;

export interface BotWithTypingIndicator extends Bot {
  $typingIndicator?: BotTypingIndicatorManager;
  $addReaction?(messageId: string, emoji: string): Promise<string | null>;
  $removeReaction?(messageId: string, reactionId: string): Promise<void>;
}

// ── 适配器集成管理器 ──────────────────────────────────────────────────

export class AdapterTypingIndicatorManager {
  private managers: Map<string, TypingIndicatorManager> = new Map();
  private configs: Map<string, AdapterTypingIndicatorConfig> = new Map();

  /**
   * 为 Bot 启用 Typing Indicator
   */
  enableForBot(
    bot: BotWithTypingIndicator,
    platform: string,
    config?: Partial<AdapterTypingIndicatorConfig>,
    outbound?: OutboundAdapter,
  ): TypingIndicatorManager {
    const botKey = `${platform}:${bot.$id}`;

    // 如果已经启用，返回现有的管理器
    if (this.managers.has(botKey)) {
      return this.managers.get(botKey)!;
    }

    // 获取平台特性
    const features = PLATFORM_FEATURES[platform] || {
      platform,
      supportsReaction: false,
      supportsEdit: false,
      supportsDelete: true,
      supportsTyping: false,
      defaultType: 'message',
    };

    // 合并配置
    const mergedConfig: AdapterTypingIndicatorConfig = {
      enabled: true,
      defaultEmoji: '⏳',
      autoRemove: true,
      removeDelay: 5000,
      ...config,
    };

    // 根据平台特性调整配置
    if (!features.supportsReaction) {
      // 如果平台不支持 reaction，强制使用 message
      if (mergedConfig.privateConfig?.type === 'reaction') {
        mergedConfig.privateConfig.type = 'message';
      }
      if (mergedConfig.groupConfig?.type === 'reaction') {
        mergedConfig.groupConfig.type = 'message';
      }
    }

    // 创建管理器
    const manager = new TypingIndicatorManager({
      type: features.defaultType,
      emoji: mergedConfig.defaultEmoji,
      autoRemove: mergedConfig.autoRemove,
      removeDelay: mergedConfig.removeDelay,
    });

    this.registerAdapter(manager, bot, platform, features, outbound);

    // 存储管理器和配置
    this.managers.set(botKey, manager);
    this.configs.set(botKey, mergedConfig);

    // 将管理器附加到 Bot
    bot.$typingIndicator = manager;

    return manager;
  }

  /**
   * 注册平台适配器
   */
  private registerAdapter(
    manager: TypingIndicatorManager,
    bot: BotWithTypingIndicator,
    platform: string,
    features: PlatformFeatures,
    outbound?: OutboundAdapter,
  ): void {
    const sendMessage = createOutboundSendMessage(bot, platform, outbound);
    if (features.supportsReaction && bot.$addReaction && bot.$removeReaction) {
      // 支持 reaction 的平台使用 ReactionTypingIndicatorAdapter
      const adapter = new ReactionTypingIndicatorAdapter(
        // addReaction
        async (messageId: string, emoji: string) => {
          try {
            return await bot.$addReaction!(messageId, emoji);
          } catch (error) {
            console.error(`[${platform}] Failed to add reaction:`, error);
            return null;
          }
        },
        // removeReaction
        async (messageId: string, reactionId: string) => {
          try {
            await bot.$removeReaction!(messageId, reactionId);
          } catch (error) {
            console.error(`[${platform}] Failed to remove reaction:`, error);
          }
        },
        sendMessage,
        // deleteMessage
        async (messageId: string) => {
          try {
            await bot.$recallMessage(messageId);
          } catch (error) {
            console.error(`[${platform}] Failed to delete message:`, error);
          }
        },
        // editMessage
        async (messageId: string, content: string) => {
          try {
            const editBot = bot as BotWithEditing;
            if (typeof editBot.$editMessage === 'function') {
              await editBot.$editMessage!(messageId, content);
            } else if (typeof editBot.$updateMessage === 'function') {
              await editBot.$updateMessage!(messageId, content);
            }
          } catch (error) {
            console.error(`[${platform}] Failed to edit message:`, error);
          }
        },
      );

      manager.registerAdapter(adapter);
    } else {
      // 不支持 reaction 的平台使用 GenericTypingIndicatorAdapter
      const adapter = new GenericTypingIndicatorAdapter(
        platform,
        sendMessage,
        // deleteMessage
        async (messageId: string) => {
          try {
            await bot.$recallMessage(messageId);
          } catch (error) {
            console.error(`[${platform}] Failed to delete message:`, error);
          }
        },
        // editMessage
        async (messageId: string, content: string) => {
          try {
            const editBot = bot as BotWithEditing;
            if (typeof editBot.$editMessage === 'function') {
              await editBot.$editMessage!(messageId, content);
            } else if (typeof editBot.$updateMessage === 'function') {
              await editBot.$updateMessage!(messageId, content);
            }
          } catch (error) {
            console.error(`[${platform}] Failed to edit message:`, error);
          }
        },
      );

      manager.registerAdapter(adapter);
    }
  }

  /**
   * 解析会话 ID
   */
  private parseSessionId(sessionId: string): [string, string] {
    const parts = sessionId.split(':');
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    return ['private', sessionId];
  }

  /**
   * 获取 Bot 的管理器
   */
  getManager(platform: string, botId: string): TypingIndicatorManager | undefined {
    return this.managers.get(`${platform}:${botId}`);
  }

  /**
   * 获取 Bot 的配置
   */
  getConfig(platform: string, botId: string): AdapterTypingIndicatorConfig | undefined {
    return this.configs.get(`${platform}:${botId}`);
  }

  /**
   * 停止 Bot 的所有提示
   */
  async stopAll(platform: string, botId: string): Promise<void> {
    const manager = this.managers.get(`${platform}:${botId}`);
    if (manager) {
      await manager.stopAll();
    }
  }

  /**
   * 停止所有 Bot 的所有提示
   */
  async stopAllBots(): Promise<void> {
    for (const manager of this.managers.values()) {
      await manager.stopAll();
    }
  }

  /**
   * 移除 Bot 的管理器
   */
  removeBot(platform: string, botId: string): void {
    const botKey = `${platform}:${botId}`;
    this.managers.delete(botKey);
    this.configs.delete(botKey);
  }

  /**
   * 清除所有管理器
   */
  clearAll(): void {
    this.managers.clear();
    this.configs.clear();
  }

  /**
   * 获取所有已注册的 Bot
   */
  getRegisteredBots(): Array<{ platform: string; botId: string }> {
    const bots: Array<{ platform: string; botId: string }> = [];
    for (const key of this.managers.keys()) {
      const [platform, botId] = key.split(':');
      bots.push({ platform, botId });
    }
    return bots;
  }

  /**
   * 获取平台特性
   */
  getPlatformFeatures(platform: string): PlatformFeatures | undefined {
    return PLATFORM_FEATURES[platform];
  }

  /**
   * 检查平台是否支持 Typing Indicator
   */
  supportsTypingIndicator(platform: string): boolean {
    const features = PLATFORM_FEATURES[platform];
    return features ? features.defaultType !== 'none' : false;
  }
}

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalAdapterManager: AdapterTypingIndicatorManager | null = null;

/**
 * 获取全局适配器 Typing Indicator 管理器
 */
export function getAdapterTypingIndicatorManager(): AdapterTypingIndicatorManager {
  if (!globalAdapterManager) {
    globalAdapterManager = new AdapterTypingIndicatorManager();
  }
  return globalAdapterManager;
}

/**
 * 初始化适配器 Typing Indicator 管理器
 */
export function initAdapterTypingIndicatorManager(): AdapterTypingIndicatorManager {
  globalAdapterManager = new AdapterTypingIndicatorManager();
  return globalAdapterManager;
}

// ── 便捷函数 ──────────────────────────────────────────────────────────

function resolveTypingSceneType(options: {
  sceneType?: 'private' | 'group' | 'channel';
  groupId?: string;
  sessionId: string;
}): 'private' | 'group' | 'channel' {
  if (options.sceneType) return options.sceneType;
  if (options.groupId) return 'group';
  const prefix = options.sessionId.split(':')[0];
  if (prefix === 'group' || prefix === 'private' || prefix === 'channel') {
    return prefix;
  }
  return 'private';
}

/**
 * 为 Bot 启用 Typing Indicator
 */
export function enableTypingIndicatorForBot(
  bot: BotWithTypingIndicator,
  platform: string,
  config?: Partial<AdapterTypingIndicatorConfig>,
  outbound?: OutboundAdapter,
): TypingIndicatorManager {
  return getAdapterTypingIndicatorManager().enableForBot(bot, platform, config, outbound);
}

/**
 * 快速开始提示
 */
export async function startTypingForBot(
  bot: BotWithTypingIndicator,
  platform: string,
  options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType?: 'private' | 'group' | 'channel';
  },
  config?: Partial<AdapterTypingIndicatorConfig>,
  outbound?: OutboundAdapter,
): Promise<TypingIndicator> {
  const manager = enableTypingIndicatorForBot(bot, platform, config, outbound);
  return await manager.start({
    ...options,
    platform,
    botId: bot.$id,
    sceneType: resolveTypingSceneType(options),
  });
}

/**
 * 快速停止提示
 */
export async function stopTypingForBot(
  bot: BotWithTypingIndicator,
  platform: string,
  options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType?: 'private' | 'group' | 'channel';
  },
): Promise<void> {
  const manager = getAdapterTypingIndicatorManager().getManager(platform, bot.$id);
  if (manager) {
    await manager.stop({
      ...options,
      platform,
      botId: bot.$id,
      sceneType: resolveTypingSceneType(options),
    });
  }
}
