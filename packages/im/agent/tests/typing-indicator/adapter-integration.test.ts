import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AdapterTypingIndicatorManager,
  PLATFORM_FEATURES,
  getAdapterTypingIndicatorManager,
  initAdapterTypingIndicatorManager,
  enableTypingIndicatorForBot,
  startTypingForBot,
  stopTypingForBot,
  buildTypingSendContent,
} from '../../src/typing-indicator/adapter-integration.js';

// Mock Endpoint
const createMockEndpoint = (platform: string) => ({
  $id: '75318',
  $config: { name: '75318' },
  $connected: true,
  $sendMessage: vi.fn().mockResolvedValue('message-123'),
  $recallMessage: vi.fn().mockResolvedValue(undefined),
  $addReaction: platform === 'icqq' || platform === 'telegram' || platform === 'kook'
    ? vi.fn().mockResolvedValue('reaction-123')
    : undefined,
  $removeReaction: platform === 'icqq' || platform === 'telegram' || platform === 'kook'
    ? vi.fn().mockResolvedValue(undefined)
    : undefined,
  $typingIndicator: undefined as any,
});

describe('buildTypingSendContent', () => {
  it('QQ 群聊应附带 reply 引用', () => {
    const content = buildTypingSendContent('qq', {
      platform: 'qq',
      endpointId: 'zhin',
      sessionId: 'qq:zhin:group:g1#u1',
      messageId: 'msg-trigger',
      sceneType: 'group',
      groupId: 'g1',
    }, '正在处理中...');

    expect(content).toEqual([
      { type: 'reply', data: { id: 'msg-trigger' } },
      { type: 'text', data: { text: '正在处理中...' } },
    ]);
  });

  it('QQ 群聊无 messageId 时应跳过发送', () => {
    expect(buildTypingSendContent('qq', {
      platform: 'qq',
      endpointId: 'zhin',
      sessionId: 'qq:zhin:group:g1#u1',
      sceneType: 'group',
      groupId: 'g1',
    }, '正在处理中...')).toBeNull();
  });
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

  describe('为 Endpoint 启用', () => {
    it('应该为 ICQQ Endpoint 启用', () => {
      const bot = createMockEndpoint('icqq');
      const typingManager = manager.enableForEndpoint(bot as any, 'icqq');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该为 Telegram Endpoint 启用', () => {
      const bot = createMockEndpoint('telegram');
      const typingManager = manager.enableForEndpoint(bot as any, 'telegram');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该为 DingTalk Endpoint 启用', () => {
      const bot = createMockEndpoint('dingtalk');
      const typingManager = manager.enableForEndpoint(bot as any, 'dingtalk');

      expect(typingManager).toBeDefined();
      expect(bot.$typingIndicator).toBe(typingManager);
    });

    it('应该为 KOOK Endpoint 注册 kook 平台适配器（非硬编码 icqq）', () => {
      const bot = createMockEndpoint('kook');
      const typingManager = manager.enableForEndpoint(bot as any, 'kook');

      expect(typingManager).toBeDefined();
      expect(typingManager.getAdapter('kook')).toBeDefined();
      expect(typingManager.getAdapter('icqq')).toBeUndefined();
    });

    it('addReaction 应在 endpoint 实例上调用以保留 this', async () => {
      const bot = createMockEndpoint('kook');
      let capturedThis: unknown;
      bot.$addReaction = vi.fn(async function (this: unknown) {
        capturedThis = this;
        return 'reaction:direct:msg-1:⏳';
      });

      const typingManager = manager.enableForEndpoint(bot as any, 'kook');
      await typingManager.start({
        platform: 'kook',
        endpointId: '75318',
        sessionId: 'private:user-1',
        messageId: 'msg-1',
        sceneType: 'private',
        userId: 'user-1',
      });

      expect(capturedThis).toBe(bot);
      expect(bot.$addReaction).toHaveBeenCalledWith(
        'msg-1',
        '⏳',
        { sceneType: 'private' },
      );
    });

    it('应该复用已有的管理器', () => {
      const bot = createMockEndpoint('icqq');
      const typingManager1 = manager.enableForEndpoint(bot as any, 'icqq');
      const typingManager2 = manager.enableForEndpoint(bot as any, 'icqq');

      expect(typingManager1).toBe(typingManager2);
    });

    it('应该支持自定义配置', () => {
      const bot = createMockEndpoint('icqq');
      const typingManager = manager.enableForEndpoint(bot as any, 'icqq', {
        defaultEmoji: '👍',
        autoRemove: false,
      });

      expect(typingManager).toBeDefined();
    });

    it('应该处理不支持 reaction 的平台', () => {
      const bot = createMockEndpoint('dingtalk');
      const typingManager = manager.enableForEndpoint(bot as any, 'dingtalk', {
        groupConfig: {
          type: 'reaction',  // DingTalk 不支持 reaction
          emoji: '⏳',
        },
      });

      expect(typingManager).toBeDefined();
    });

    it('QQ 群聊 typing 应通过 reply 被动发送', async () => {
      const bot = createMockEndpoint('qq');
      const sendMessage = vi.fn().mockResolvedValue('group-g1:sent-1');
      const typingManager = manager.enableForEndpoint(bot as any, 'qq', undefined, { sendMessage });

      await typingManager.start({
        platform: 'qq',
        endpointId: '75318',
        sessionId: 'qq:75318:group:g1#u1',
        messageId: 'msg-trigger',
        sceneType: 'group',
        groupId: 'g1',
      });

      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'group',
        id: 'g1',
        content: [
          { type: 'reply', data: { id: 'msg-trigger' } },
          { type: 'text', data: { text: '正在处理中...' } },
        ],
      }));
    });
  });

  describe('管理器操作', () => {
    it('应该获取管理器', () => {
      const bot = createMockEndpoint('icqq');
      manager.enableForEndpoint(bot as any, 'icqq');

      const typingManager = manager.getManager('icqq', '75318');
      expect(typingManager).toBeDefined();
    });

    it('应该获取配置', () => {
      const bot = createMockEndpoint('icqq');
      manager.enableForEndpoint(bot as any, 'icqq', {
        defaultEmoji: '👍',
      });

      const config = manager.getConfig('icqq', '75318');
      expect(config).toBeDefined();
      expect(config?.defaultEmoji).toBe('👍');
    });

    it('应该获取所有已注册的 Bot', () => {
      const bot1 = createMockEndpoint('icqq');
      const bot2 = createMockEndpoint('telegram');
      bot2.$id = '123456';

      manager.enableForEndpoint(bot1 as any, 'icqq');
      manager.enableForEndpoint(bot2 as any, 'telegram');

      const bots = manager.getRegisteredEndpoints();
      expect(bots.length).toBe(2);
      expect(bots).toContainEqual({ platform: 'icqq', endpointId: '75318' });
      expect(bots).toContainEqual({ platform: 'telegram', endpointId: '123456' });
    });

    it('应该移除 Bot', () => {
      const bot = createMockEndpoint('icqq');
      manager.enableForEndpoint(bot as any, 'icqq');

      manager.removeBot('icqq', '75318');

      const typingManager = manager.getManager('icqq', '75318');
      expect(typingManager).toBeUndefined();
    });

    it('应该清除所有管理器', () => {
      const bot1 = createMockEndpoint('icqq');
      const bot2 = createMockEndpoint('telegram');
      bot2.$id = '123456';

      manager.enableForEndpoint(bot1 as any, 'icqq');
      manager.enableForEndpoint(bot2 as any, 'telegram');

      manager.clearAll();

      const bots = manager.getRegisteredEndpoints();
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
  it('应该为 Endpoint 启用 Typing Indicator', () => {
    const bot = createMockEndpoint('icqq');
    const typingManager = enableTypingIndicatorForBot(bot as any, 'icqq');

    expect(typingManager).toBeDefined();
    expect(bot.$typingIndicator).toBe(typingManager);
  });

  it('应该支持自定义配置', () => {
    const bot = createMockEndpoint('icqq');
    const typingManager = enableTypingIndicatorForBot(bot as any, 'icqq', {
      defaultEmoji: '👍',
    });

    expect(typingManager).toBeDefined();
  });
});
