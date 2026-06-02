import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AdapterTypingIndicatorManager,
  PLATFORM_FEATURES,
  getAdapterTypingIndicatorManager,
  initAdapterTypingIndicatorManager,
  enableTypingIndicatorForBot,
  startTypingForBot,
  stopTypingForBot,
} from '../../src/typing-indicator/adapter-integration.js';

// Mock Bot
const createMockBot = (platform: string) => ({
  $id: '75318',
  $config: { name: '75318' },
  $connected: true,
  $sendMessage: vi.fn().mockResolvedValue('message-123'),
  $recallMessage: vi.fn().mockResolvedValue(undefined),
  $addReaction: platform === 'icqq' || platform === 'telegram' ? vi.fn().mockResolvedValue('reaction-123') : undefined,
  $removeReaction: platform === 'icqq' || platform === 'telegram' ? vi.fn().mockResolvedValue(undefined) : undefined,
  $typingIndicator: undefined as any,
});

describe('AdapterTypingIndicatorManager', () => {
  let manager: AdapterTypingIndicatorManager;

  beforeEach(() => {
    manager = new AdapterTypingIndicatorManager();
  });

  describe('基本功能', () => {
    it('应该创建管理器', () => {
      expect(manager).toBeDefined();
    });

    it('应该获取平台特性', () => {
      const icqqFeatures = manager.getPlatformFeatures('icqq');
      expect(icqqFeatures).toBeDefined();
      expect(icqqFeatures?.platform).toBe('icqq');
      expect(icqqFeatures?.supportsReaction).toBe(true);

      const telegramFeatures = manager.getPlatformFeatures('telegram');
      expect(telegramFeatures).toBeDefined();
      expect(telegramFeatures?.platform).toBe('telegram');
      expect(telegramFeatures?.supportsTyping).toBe(true);

      const dingtalkFeatures = manager.getPlatformFeatures('dingtalk');
      expect(dingtalkFeatures).toBeDefined();
      expect(dingtalkFeatures?.platform).toBe('dingtalk');
      expect(dingtalkFeatures?.supportsReaction).toBe(false);
    });

    it('应该检查平台支持', () => {
      expect(manager.supportsTypingIndicator('icqq')).toBe(true);
      expect(manager.supportsTypingIndicator('telegram')).toBe(true);
      expect(manager.supportsTypingIndicator('dingtalk')).toBe(true);
      expect(manager.supportsTypingIndicator('email')).toBe(false);
    });
  });

  describe('为 Bot 启用', () => {
    it('应该为 ICQQ Bot 启用', () => {
      const bot = createMockBot('icqq');
      const typingManager = manager.enableForBot(bot as any, 'icqq');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该为 Telegram Bot 启用', () => {
      const bot = createMockBot('telegram');
      const typingManager = manager.enableForBot(bot as any, 'telegram');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该为 DingTalk Bot 启用', () => {
      const bot = createMockBot('dingtalk');
      const typingManager = manager.enableForBot(bot as any, 'dingtalk');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该复用已有的管理器', () => {
      const bot = createMockBot('icqq');
      const typingManager1 = manager.enableForBot(bot as any, 'icqq');
      const typingManager2 = manager.enableForBot(bot as any, 'icqq');

      expect(typingManager1).toBe(typingManager2);
    });

    it('应该支持自定义配置', () => {
      const bot = createMockBot('icqq');
      const typingManager = manager.enableForBot(bot as any, 'icqq', {
        defaultEmoji: '👍',
        autoRemove: false,
      });

      expect(typingManager).toBeDefined();
    });

    it('应该处理不支持 reaction 的平台', () => {
      const bot = createMockBot('dingtalk');
      const typingManager = manager.enableForBot(bot as any, 'dingtalk', {
        groupConfig: {
          type: 'reaction',  // DingTalk 不支持 reaction
          emoji: '⏳',
        },
      });

      expect(typingManager).toBeDefined();
    });
  });

  describe('管理器操作', () => {
    it('应该获取管理器', () => {
      const bot = createMockBot('icqq');
      manager.enableForBot(bot as any, 'icqq');

      const typingManager = manager.getManager('icqq', '75318');
      expect(typingManager).toBeDefined();
    });

    it('应该获取配置', () => {
      const bot = createMockBot('icqq');
      manager.enableForBot(bot as any, 'icqq', {
        defaultEmoji: '👍',
      });

      const config = manager.getConfig('icqq', '75318');
      expect(config).toBeDefined();
      expect(config?.defaultEmoji).toBe('👍');
    });

    it('应该获取所有已注册的 Bot', () => {
      const bot1 = createMockBot('icqq');
      const bot2 = createMockBot('telegram');
      bot2.$id = '123456';

      manager.enableForBot(bot1 as any, 'icqq');
      manager.enableForBot(bot2 as any, 'telegram');

      const bots = manager.getRegisteredBots();
      expect(bots.length).toBe(2);
      expect(bots).toContainEqual({ platform: 'icqq', botId: '75318' });
      expect(bots).toContainEqual({ platform: 'telegram', botId: '123456' });
    });

    it('应该移除 Bot', () => {
      const bot = createMockBot('icqq');
      manager.enableForBot(bot as any, 'icqq');

      manager.removeBot('icqq', '75318');

      const typingManager = manager.getManager('icqq', '75318');
      expect(typingManager).toBeUndefined();
    });

    it('应该清除所有管理器', () => {
      const bot1 = createMockBot('icqq');
      const bot2 = createMockBot('telegram');
      bot2.$id = '123456';

      manager.enableForBot(bot1 as any, 'icqq');
      manager.enableForBot(bot2 as any, 'telegram');

      manager.clearAll();

      const bots = manager.getRegisteredBots();
      expect(bots.length).toBe(0);
    });
  });
});

describe('PLATFORM_FEATURES', () => {
  it('应该有所有平台的特性定义', () => {
    const platforms = [
      'icqq', 'telegram', 'discord', 'kook', 'slack', 'lark',
      'dingtalk', 'qq', 'onebot11', 'onebot12', 'napcat',
      'github', 'satori', 'email', 'wechat-mp', 'milky', 'sandbox',
    ];

    for (const platform of platforms) {
      expect(PLATFORM_FEATURES[platform]).toBeDefined();
      expect(PLATFORM_FEATURES[platform].platform).toBe(platform);
    }
  });

  it('应该正确定义平台特性', () => {
    // ICQQ 支持 reaction
    expect(PLATFORM_FEATURES.icqq.supportsReaction).toBe(true);
    expect(PLATFORM_FEATURES.icqq.defaultType).toBe('reaction');

    // Telegram 支持 typing
    expect(PLATFORM_FEATURES.telegram.supportsTyping).toBe(true);
    expect(PLATFORM_FEATURES.telegram.defaultType).toBe('typing');

    // DingTalk 只支持 message
    expect(PLATFORM_FEATURES.dingtalk.supportsReaction).toBe(false);
    expect(PLATFORM_FEATURES.dingtalk.defaultType).toBe('message');

    // Email 不支持
    expect(PLATFORM_FEATURES.email.defaultType).toBe('none');
  });
});

describe('全局实例', () => {
  it('应该获取全局实例', () => {
    const instance = getAdapterTypingIndicatorManager();
    expect(instance).toBeDefined();
  });

  it('应该初始化全局实例', () => {
    const instance = initAdapterTypingIndicatorManager();
    expect(instance).toBeDefined();
  });
});

describe('便捷函数', () => {
  it('应该为 Bot 启用 Typing Indicator', () => {
    const bot = createMockBot('icqq');
    const typingManager = enableTypingIndicatorForBot(bot as any, 'icqq');

    expect(typingManager).toBeDefined();
    expect(bot.$typingIndicator).toBe(typingManager);
  });

  it('应该支持自定义配置', () => {
    const bot = createMockBot('icqq');
    const typingManager = enableTypingIndicatorForBot(bot as any, 'icqq', {
      defaultEmoji: '👍',
    });

    expect(typingManager).toBeDefined();
  });
});
