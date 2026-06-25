/**
 * ICQQ Typing Indicator 集成
 *
 * 为 ICQQ 适配器提供消息处理状态提示功能，
 * 使用消息回应（表情）来提示用户"AI 正在处理"。
 */

import type { IcqqEndpoint } from './endpoint.js';
import {
  TypingIndicatorManager,
  ReactionTypingIndicatorAdapter,
  type TypingIndicatorOptions,
  type TypingIndicatorConfig,
  type TypingIndicator,
} from '@zhin.js/agent';

// ── ICQQ 特定配置 ────────────────────────────────────────────────────

export interface ICQQTypingIndicatorConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 默认表情 */
  defaultEmoji: string;
  /** 是否在完成后自动移除 */
  autoRemove: boolean;
  /** 自动移除延迟（毫秒） */
  removeDelay: number;
  /** 私聊配置 */
  privateConfig?: Partial<TypingIndicatorConfig>;
  /** 群聊配置 */
  groupConfig?: Partial<TypingIndicatorConfig>;
}

const DEFAULT_ICQQ_CONFIG: ICQQTypingIndicatorConfig = {
  enabled: true,
  defaultEmoji: '⏳',
  autoRemove: true,
  removeDelay: 5000,
  privateConfig: {
    type: 'message',
    message: '正在思考中...',
    autoRemove: true,
    removeDelay: 3000,
  },
  groupConfig: {
    type: 'reaction',
    emoji: '⏳',
    autoRemove: true,
    removeDelay: 5000,
  },
};

// ── ICQQ Typing Indicator 管理器 ─────────────────────────────────────

export class ICQQTypingIndicatorManager {
  private manager: TypingIndicatorManager;
  private config: ICQQTypingIndicatorConfig;
  private endpoint: IcqqEndpoint;

  constructor(endpoint: IcqqEndpoint, config: Partial<ICQQTypingIndicatorConfig> = {}) {
    this.endpoint = endpoint;
    this.config = { ...DEFAULT_ICQQ_CONFIG, ...config };

    // 创建 Typing Indicator 管理器
    this.manager = new TypingIndicatorManager({
      type: 'reaction',
      emoji: this.config.defaultEmoji,
      autoRemove: this.config.autoRemove,
      removeDelay: this.config.removeDelay,
    });

    // 注册 ICQQ 适配器
    this.registerAdapter();
  }

  /**
   * 注册 ICQQ 适配器
   */
  private registerAdapter(): void {
    const adapter = new ReactionTypingIndicatorAdapter(
      'icqq',
      // addReaction
      async (messageId: string, emoji: string, _options) => {
        return await this.endpoint.$addReaction(messageId, emoji);
      },
      // removeReaction
      async (messageId: string, reactionId: string) => {
        await this.endpoint.$removeReaction(messageId, reactionId);
      },
      // sendMessage
      async (options: TypingIndicatorOptions, content: string) => {
        try {
          this.endpoint.logger.debug('[ICQQ:TypingIndicator] sendMessage called', {
            sessionId: options.sessionId,
            content,
            sceneType: options.sceneType,
            groupId: options.groupId,
            userId: options.userId,
          });

          // 根据场景类型发送消息
          if (options.sceneType === 'group' && options.groupId) {
            this.endpoint.logger.debug('[ICQQ:TypingIndicator] sending group message', {
              groupId: options.groupId,
            });
            return await this.endpoint.$sendMessage({
              type: 'group',
              id: options.groupId,
              context: 'icqq',
              endpoint: this.endpoint.$id,
              content: [{ type: 'text', data: { text: content } }],
            });
          } else if (options.userId) {
            this.endpoint.logger.debug('[ICQQ:TypingIndicator] sending private message', {
              userId: options.userId,
              groupId: options.groupId,
            });
            return await this.endpoint.$sendMessage({
              type: 'private',
              id: options.userId,
              ...(options.groupId
                ? { parent: { type: 'group' as const, id: options.groupId } }
                : {}),
              context: 'icqq',
              endpoint: this.endpoint.$id,
              content: [{ type: 'text', data: { text: content } }],
            });
          }

          this.endpoint.logger.debug('[ICQQ:TypingIndicator] no valid target', {
            sceneType: options.sceneType,
            groupId: options.groupId,
            userId: options.userId,
          });
          return null;
        } catch (error) {
          this.endpoint.logger.error('[ICQQ:TypingIndicator] Failed to send typing message:', error);
          return null;
        }
      },
      // deleteMessage
      async (messageId: string) => {
        try {
          await this.endpoint.$recallMessage(messageId);
        } catch (error) {
          this.endpoint.logger.error('[ICQQ:TypingIndicator] Failed to delete typing message:', error);
        }
      },
    );

    this.manager.registerAdapter(adapter);
  }

  /**
   * 开始提示
   */
  async start(options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  }): Promise<TypingIndicator> {
    this.endpoint.logger.debug('[ICQQ:TypingIndicator] start called', {
      enabled: this.config.enabled,
      sceneType: options.sceneType,
      messageId: options.messageId,
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
    });

    if (!this.config.enabled) {
      this.endpoint.logger.debug('[ICQQ:TypingIndicator] disabled, returning noop');
      return {
        start: async () => {},
        stop: async () => {},
        isActive: () => false,
      };
    }

    // 根据场景类型选择配置
    const config = options.sceneType === 'group'
      ? this.config.groupConfig
      : this.config.privateConfig;

    this.endpoint.logger.debug('[ICQQ:TypingIndicator] using config', {
      sceneType: options.sceneType,
      configType: config?.type,
      configEmoji: config?.emoji,
      configMessage: config?.message,
    });

    const typingOptions: TypingIndicatorOptions = {
      messageId: options.messageId,
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
      platform: 'icqq',
      endpointId: this.endpoint.$id,
      sceneType: options.sceneType,
    };

    this.endpoint.logger.debug('[ICQQ:TypingIndicator] starting manager', typingOptions);

    const result = await this.manager.start(typingOptions, config);

    this.endpoint.logger.debug('[ICQQ:TypingIndicator] started', {
      isActive: result.isActive(),
    });

    return result;
  }

  /**
   * 停止提示
   */
  async stop(options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
  }): Promise<void> {
    this.endpoint.logger.debug('[ICQQ:TypingIndicator] stop called', {
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
    });

    const typingOptions: TypingIndicatorOptions = {
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
      platform: 'icqq',
      endpointId: this.endpoint.$id,
      sceneType: 'private', // 默认值，实际会根据 sessionId 判断
    };

    await this.manager.stop(typingOptions);

    this.endpoint.logger.debug('[ICQQ:TypingIndicator] stopped');
  }

  /**
   * 停止所有提示
   */
  async stopAll(): Promise<void> {
    this.endpoint.logger.debug('[ICQQ:TypingIndicator] stopAll called');
    await this.manager.stopAll();
    this.endpoint.logger.debug('[ICQQ:TypingIndicator] stopAll completed');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ICQQTypingIndicatorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): ICQQTypingIndicatorConfig {
    return { ...this.config };
  }
}

// ── 便捷函数 ──────────────────────────────────────────────────────────

/**
 * 为 ICQQ Endpoint 创建 Typing Indicator 管理器
 */
export function createICQQTypingIndicatorManager(
  endpoint: IcqqEndpoint,
  config?: Partial<ICQQTypingIndicatorConfig>,
): ICQQTypingIndicatorManager {
  return new ICQQTypingIndicatorManager(endpoint, config);
}

/**
 * 快速开始提示
 */
export async function startICQQTypingIndicator(
  endpoint: IcqqEndpoint,
  options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  },
  config?: Partial<ICQQTypingIndicatorConfig>,
): Promise<TypingIndicator> {
  const manager = createICQQTypingIndicatorManager(endpoint, config);
  return await manager.start(options);
}

// ── 类型扩展 ──────────────────────────────────────────────────────────

declare module './endpoint.js' {
  interface IcqqEndpoint {
    /** Typing Indicator 管理器 */
    $typingIndicator?: ICQQTypingIndicatorManager;
  }
}

/**
 * 为 IcqqEndpoint 添加 Typing Indicator 支持
 */
export function enableTypingIndicator(
  endpoint: IcqqEndpoint,
  config?: Partial<ICQQTypingIndicatorConfig>,
): ICQQTypingIndicatorManager {
  if (!endpoint.$typingIndicator) {
    endpoint.$typingIndicator = createICQQTypingIndicatorManager(endpoint, config);
  }
  return endpoint.$typingIndicator;
}
