/**
 * NapCat Typing Indicator 集成
 *
 * 群聊：set_msg_emoji_like（表情回应）
 * 私聊：set_input_status（输入状态）或短暂提示消息
 */

import type { NapCatBotBase } from './bot-base.js';
import {
  TypingIndicatorManager,
  ReactionTypingIndicatorAdapter,
  type TypingIndicatorOptions,
  type TypingIndicatorConfig,
  type TypingIndicator,
} from '@zhin.js/agent';

export interface NapCatTypingIndicatorConfig {
  enabled: boolean;
  defaultEmoji: string;
  autoRemove: boolean;
  removeDelay: number;
  privateConfig?: Partial<TypingIndicatorConfig>;
  groupConfig?: Partial<TypingIndicatorConfig>;
}

const DEFAULT_CONFIG: NapCatTypingIndicatorConfig = {
  enabled: true,
  defaultEmoji: '128516',
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
    emoji: '128516',
    autoRemove: true,
    removeDelay: 5000,
  },
};

export class NapCatTypingIndicatorManager {
  private manager: TypingIndicatorManager;
  private config: NapCatTypingIndicatorConfig;
  private bot: NapCatBotBase;

  private currentOptions?: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  };

  constructor(bot: NapCatBotBase, config: Partial<NapCatTypingIndicatorConfig> = {}) {
    this.bot = bot;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.manager = new TypingIndicatorManager({
      type: 'reaction',
      emoji: this.config.defaultEmoji,
      autoRemove: this.config.autoRemove,
      removeDelay: this.config.removeDelay,
    });
    this.registerAdapter();
  }

  private registerAdapter(): void {
    const adapter = new ReactionTypingIndicatorAdapter(
      async (messageId: string, emoji: string) => {
        return await this.bot.$addReaction(messageId, emoji);
      },
      async (messageId: string, reactionId: string) => {
        await this.bot.$removeReaction(messageId, reactionId);
      },
      async (sessionId: string, content: string) => {
        try {
          const options = this.currentOptions;
          if (!options) return null;
          if (options.sceneType === 'group' && options.groupId) {
            return await this.bot.$sendMessage({
              type: 'group',
              id: options.groupId,
              context: 'napcat',
              bot: this.bot.$id,
              content: [{ type: 'text', data: { text: content } }],
            });
          } else if (options.userId) {
            return await this.bot.$sendMessage({
              type: 'private',
              id: options.userId,
              context: 'napcat',
              bot: this.bot.$id,
              content: [{ type: 'text', data: { text: content } }],
            });
          }
          return null;
        } catch {
          return null;
        }
      },
      async (messageId: string) => {
        try {
          await this.bot.$recallMessage(messageId);
        } catch { /* ignore */ }
      },
    );
    this.manager.registerAdapter(adapter);
  }

  async start(options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: 'private' | 'group';
  }): Promise<TypingIndicator> {
    this.bot.logger.debug('[NapCat:TypingIndicator] start called', {
      enabled: this.config.enabled,
      sceneType: options.sceneType,
    });

    if (!this.config.enabled) {
      return {
        start: async () => {},
        stop: async () => {},
        isActive: () => false,
      };
    }

    this.currentOptions = options;

    const config = options.sceneType === 'group'
      ? this.config.groupConfig
      : this.config.privateConfig;

    const typingOptions: TypingIndicatorOptions = {
      messageId: options.messageId,
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
      platform: 'napcat',
      botId: this.bot.$id,
      sceneType: options.sceneType,
    };

    return await this.manager.start(typingOptions, config);
  }

  async stop(options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
  }): Promise<void> {
    const typingOptions: TypingIndicatorOptions = {
      sessionId: options.sessionId,
      userId: options.userId,
      groupId: options.groupId,
      platform: 'napcat',
      botId: this.bot.$id,
      sceneType: 'private',
    };
    await this.manager.stop(typingOptions);
    this.currentOptions = undefined;
  }

  async stopAll(): Promise<void> {
    await this.manager.stopAll();
  }

  updateConfig(config: Partial<NapCatTypingIndicatorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): NapCatTypingIndicatorConfig {
    return { ...this.config };
  }
}

declare module './bot-base.js' {
  interface NapCatBotBase {
    $typingIndicator?: NapCatTypingIndicatorManager;
  }
}

export function enableTypingIndicator(
  bot: NapCatBotBase,
  config?: Partial<NapCatTypingIndicatorConfig>,
): NapCatTypingIndicatorManager {
  if (!(bot as any).$typingIndicator) {
    (bot as any).$typingIndicator = new NapCatTypingIndicatorManager(bot, config);
  }
  return (bot as any).$typingIndicator;
}
