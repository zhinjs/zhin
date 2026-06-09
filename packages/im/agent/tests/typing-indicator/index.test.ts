import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TypingIndicatorManager,
  ReactionTypingIndicator,
  MessageTypingIndicator,
  NoneTypingIndicator,
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  initTypingIndicatorManager,
  getTypingIndicatorManager,
  startTypingIndicator,
  stopTypingIndicator,
} from '../../src/typing-indicator/index.js';

describe('TypingIndicatorManager', () => {
  let manager: TypingIndicatorManager;

  beforeEach(() => {
    manager = new TypingIndicatorManager();
  });

  describe('基本功能', () => {
    it('应该创建管理器', () => {
      expect(manager).toBeDefined();
    });

    it('应该注册适配器', () => {
      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn(),
      };

      manager.registerAdapter(adapter);

      expect(manager.getAdapter('icqq')).toBe(adapter);
    });

    it('应该获取适配器', () => {
      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn(),
      };

      manager.registerAdapter(adapter);

      expect(manager.getAdapter('icqq')).toBe(adapter);
      expect(manager.getAdapter('unknown')).toBeUndefined();
    });
  });

  describe('创建提示实例', () => {
    it('应该创建提示实例', () => {
      const mockIndicator = {
        start: vi.fn(),
        stop: vi.fn(),
        isActive: vi.fn().mockReturnValue(false),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      const indicator = manager.createIndicator({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(indicator).toBe(mockIndicator);
    });

    it('应该使用默认配置', () => {
      const mockIndicator = {
        start: vi.fn(),
        stop: vi.fn(),
        isActive: vi.fn().mockReturnValue(false),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      manager.createIndicator({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(adapter.createIndicator).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'icqq',
          botId: '75318',
        }),
        expect.objectContaining({
          type: 'reaction',
          emoji: '⏳',
        }),
      );
    });

    it('应该回退到支持的类型', () => {
      const mockIndicator = {
        start: vi.fn(),
        stop: vi.fn(),
        isActive: vi.fn().mockReturnValue(false),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['message'],  // 只支持 message
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      manager.createIndicator(
        {
          platform: 'icqq',
          botId: '75318',
          sessionId: 'private:liuchunlang',
          sceneType: 'private',
        },
        { type: 'reaction' },  // 请求 reaction，但平台只支持 message
      );

      expect(adapter.createIndicator).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'message',  // 应该回退到 message
        }),
      );
    });

    it('应该返回 NoneTypingIndicator 当没有适配器时', () => {
      const indicator = manager.createIndicator({
        platform: 'unknown',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(indicator).toBeInstanceOf(NoneTypingIndicator);
    });
  });

  describe('管理提示', () => {
    it('应该开始提示', async () => {
      const mockIndicator = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(true),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      const indicator = await manager.start({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(mockIndicator.start).toHaveBeenCalled();
      expect(indicator.isActive()).toBe(true);
    });

    it('应该停止提示', async () => {
      const mockIndicator = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(false),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      await manager.start({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      await manager.stop({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(mockIndicator.stop).toHaveBeenCalled();
    });

    it('应该停止所有提示', async () => {
      const mockIndicator1 = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(false),
      };

      const mockIndicator2 = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(false),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn()
          .mockReturnValueOnce(mockIndicator1)
          .mockReturnValueOnce(mockIndicator2),
      };

      manager.registerAdapter(adapter);

      await manager.start({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'session1',
        sceneType: 'private',
      });

      await manager.start({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'session2',
        sceneType: 'private',
      });

      await manager.stopAll();

      expect(mockIndicator1.stop).toHaveBeenCalled();
      expect(mockIndicator2.stop).toHaveBeenCalled();
    });
  });
});

describe('ReactionTypingIndicator', () => {
  it('应该创建实例', () => {
    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        messageId: '123456',
        sceneType: 'private',
      },
      {
        type: 'reaction',
        emoji: '⏳',
      },
      vi.fn(),
      vi.fn(),
    );

    expect(indicator).toBeDefined();
  });

  it('应该开始提示', async () => {
    const addReaction = vi.fn().mockResolvedValue('reaction-123');
    const removeReaction = vi.fn();

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        messageId: '123456',
        sceneType: 'private',
      },
      {
        type: 'reaction',
        emoji: '⏳',
      },
      addReaction,
      removeReaction,
    );

    await indicator.start();

    expect(addReaction).toHaveBeenCalledWith('123456', '⏳', expect.objectContaining({
      platform: 'icqq',
      messageId: '123456',
      sceneType: 'private',
    }));
    expect(indicator.isActive()).toBe(true);
  });

  it('应该停止提示', async () => {
    const addReaction = vi.fn().mockResolvedValue('reaction-123');
    const removeReaction = vi.fn();

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        messageId: '123456',
        sceneType: 'private',
      },
      {
        type: 'reaction',
        emoji: '⏳',
      },
      addReaction,
      removeReaction,
    );

    await indicator.start();
    await indicator.stop();

    expect(removeReaction).toHaveBeenCalledWith('123456', 'reaction-123');
    expect(indicator.isActive()).toBe(false);
  });

  it('并发 stop 只应 remove 一次', async () => {
    const addReaction = vi.fn().mockResolvedValue('reaction-123');
    const removeReaction = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20)),
    );

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        messageId: '123456',
        sceneType: 'private',
      },
      { type: 'reaction', emoji: '⏳' },
      addReaction,
      removeReaction,
    );

    await indicator.start();
    await Promise.all([indicator.stop(), indicator.stop()]);
    expect(removeReaction).toHaveBeenCalledTimes(1);
  });

  it('应该处理没有 messageId 的情况', async () => {
    const addReaction = vi.fn();
    const removeReaction = vi.fn();

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sceneType: 'private',
      },
      {
        type: 'reaction',
        emoji: '⏳',
      },
      addReaction,
      removeReaction,
    );

    await indicator.start();

    expect(addReaction).not.toHaveBeenCalled();
    expect(indicator.isActive()).toBe(false);
  });
});

describe('MessageTypingIndicator', () => {
  it('应该创建实例', () => {
    const indicator = new MessageTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
      },
      vi.fn(),
      vi.fn(),
    );

    expect(indicator).toBeDefined();
  });

  it('应该开始提示', async () => {
    const sendMessage = vi.fn().mockResolvedValue('message-123');
    const deleteMessage = vi.fn();

    const indicator = new MessageTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
      },
      sendMessage,
      deleteMessage,
    );

    await indicator.start();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      }),
      '正在处理中...',
    );
    expect(indicator.isActive()).toBe(true);
  });

  it('应该停止提示', async () => {
    const sendMessage = vi.fn().mockResolvedValue('message-123');
    const deleteMessage = vi.fn();

    const indicator = new MessageTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
        autoRemove: true,
      },
      sendMessage,
      deleteMessage,
    );

    await indicator.start();
    await indicator.stop();

    expect(deleteMessage).toHaveBeenCalledWith('message-123');
    expect(indicator.isActive()).toBe(false);
  });

  it('应该处理没有 sessionId 的情况', async () => {
    const sendMessage = vi.fn();
    const deleteMessage = vi.fn();

    const indicator = new MessageTypingIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
      },
      sendMessage,
      deleteMessage,
    );

    await indicator.start();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(indicator.isActive()).toBe(false);
  });
});

describe('NoneTypingIndicator', () => {
  it('应该创建实例', () => {
    const indicator = new NoneTypingIndicator();
    expect(indicator).toBeDefined();
  });

  it('应该不执行任何操作', async () => {
    const indicator = new NoneTypingIndicator();

    await indicator.start();
    await indicator.stop();

    expect(indicator.isActive()).toBe(false);
  });
});

describe('ReactionTypingIndicatorAdapter', () => {
  it('应该创建适配器', () => {
    const adapter = new ReactionTypingIndicatorAdapter(
      'icqq',
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    expect(adapter.platform).toBe('icqq');
    expect(adapter.supportedTypes).toContain('reaction');
    expect(adapter.supportedTypes).toContain('message');
  });

  it('应该创建 ReactionTypingIndicator', () => {
    const adapter = new ReactionTypingIndicatorAdapter(
      'icqq',
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    const indicator = adapter.createIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        messageId: '123456',
        sceneType: 'private',
      },
      {
        type: 'reaction',
        emoji: '⏳',
      },
    );

    expect(indicator).toBeInstanceOf(ReactionTypingIndicator);
  });

  it('应该创建 MessageTypingIndicator', () => {
    const adapter = new ReactionTypingIndicatorAdapter(
      'icqq',
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    const indicator = adapter.createIndicator(
      {
        platform: 'icqq',
        botId: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
      },
    );

    expect(indicator).toBeInstanceOf(MessageTypingIndicator);
  });
});

describe('GenericTypingIndicatorAdapter', () => {
  it('应该创建适配器', () => {
    const adapter = new GenericTypingIndicatorAdapter(
      'telegram',
      vi.fn(),
      vi.fn(),
    );

    expect(adapter.platform).toBe('telegram');
    expect(adapter.supportedTypes).toContain('message');
    expect(adapter.supportedTypes).toContain('none');
  });

  it('应该创建 MessageTypingIndicator', () => {
    const adapter = new GenericTypingIndicatorAdapter(
      'telegram',
      vi.fn(),
      vi.fn(),
    );

    const indicator = adapter.createIndicator(
      {
        platform: 'telegram',
        botId: '123456',
        sessionId: 'user:123456',
        sceneType: 'private',
      },
      {
        type: 'message',
        message: '正在处理中...',
      },
    );

    expect(indicator).toBeInstanceOf(MessageTypingIndicator);
  });

  it('应该创建 NoneTypingIndicator', () => {
    const adapter = new GenericTypingIndicatorAdapter(
      'telegram',
      vi.fn(),
      vi.fn(),
    );

    const indicator = adapter.createIndicator(
      {
        platform: 'telegram',
        botId: '123456',
        sessionId: 'user:123456',
        sceneType: 'private',
      },
      {
        type: 'none',
      },
    );

    expect(indicator).toBeInstanceOf(NoneTypingIndicator);
  });
});

describe('全局实例', () => {
  it('应该获取全局实例', () => {
    const instance = getTypingIndicatorManager();
    expect(instance).toBeDefined();
  });

  it('应该初始化全局实例', () => {
    const instance = initTypingIndicatorManager({
      type: 'reaction',
      emoji: '👍',
    });

    expect(instance).toBeDefined();
  });
});

describe('便捷函数', () => {
  it('应该快速开始提示', async () => {
    const manager = initTypingIndicatorManager();

    const mockIndicator = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(true),
    };

    const adapter: ICQQTypingIndicatorAdapter = {
      platform: 'icqq',
      supportedTypes: ['reaction', 'message'],
      createIndicator: vi.fn().mockReturnValue(mockIndicator),
    };

    manager.registerAdapter(adapter);

    const indicator = await startTypingIndicator({
      platform: 'icqq',
      botId: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    expect(mockIndicator.start).toHaveBeenCalled();
  });

  it('应该快速停止提示', async () => {
    const manager = initTypingIndicatorManager();

    const mockIndicator = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(false),
    };

    const adapter: ICQQTypingIndicatorAdapter = {
      platform: 'icqq',
      supportedTypes: ['reaction', 'message'],
      createIndicator: vi.fn().mockReturnValue(mockIndicator),
    };

    manager.registerAdapter(adapter);

    await startTypingIndicator({
      platform: 'icqq',
      botId: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    await stopTypingIndicator({
      platform: 'icqq',
      botId: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    expect(mockIndicator.stop).toHaveBeenCalled();
  });
});
