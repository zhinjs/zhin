import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TypingIndicatorManager,
  ReactionTypingIndicator,
  MessageTypingIndicator,
  NativeTypingIndicator,
  NoneTypingIndicator,
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  provideTypingIndicatorManager,
  getTypingIndicatorManager,
  startTypingIndicator,
  stopTypingIndicator,
} from '../../src/typing-indicator/index.js';
import { DisposeStack } from '@zhin.js/plugin-runtime';
import { AdapterActivityFeedbackManager } from '../../src/activity-feedback/adapter-integration.js';

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
        endpointKey: '75318',
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
        endpointKey: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(adapter.createIndicator).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'icqq',
          endpointKey: '75318',
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
          endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        isActive: vi.fn().mockReturnValue(true),
      };

      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction', 'message'],
        createIndicator: vi.fn().mockReturnValue(mockIndicator),
      };

      manager.registerAdapter(adapter);

      await manager.start({
        platform: 'icqq',
        endpointKey: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      await manager.stop({
        platform: 'icqq',
        endpointKey: '75318',
        sessionId: 'private:liuchunlang',
        sceneType: 'private',
      });

      expect(mockIndicator.stop).toHaveBeenCalled();
    });

    it('应该停止所有提示', async () => {
      const mockIndicator1 = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(true),
      };

      const mockIndicator2 = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(true),
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
        endpointKey: '75318',
        sessionId: 'session1',
        sceneType: 'private',
      });

      await manager.start({
        platform: 'icqq',
        endpointKey: '75318',
        sessionId: 'session2',
        sceneType: 'private',
      });

      await manager.stopAll();

      expect(mockIndicator1.stop).toHaveBeenCalled();
      expect(mockIndicator2.stop).toHaveBeenCalled();
    });

    it('启动未激活时应释放会话占位以便后续重试', async () => {
      const inactive = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(false),
      };
      const active = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(true),
      };
      const adapter: ICQQTypingIndicatorAdapter = {
        platform: 'icqq',
        supportedTypes: ['reaction'],
        createIndicator: vi.fn()
          .mockReturnValueOnce(inactive)
          .mockReturnValueOnce(active),
      };
      manager.registerAdapter(adapter);
      const options = {
        platform: 'icqq', endpointKey: 'bot', sessionId: 'group:1',
        messageId: 'message-1', sceneType: 'group' as const,
      };

      expect((await manager.start(options)).isActive()).toBe(false);
      expect((await manager.start(options)).isActive()).toBe(true);
      expect(adapter.createIndicator).toHaveBeenCalledTimes(2);
    });

    it('并发 start 应共享启动结果且不在 indicator 激活前返回', async () => {
      let releaseStart!: () => void;
      let active = false;
      const indicator = {
        start: vi.fn().mockImplementation(async () => {
          await new Promise<void>((resolve) => { releaseStart = resolve; });
          active = true;
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn(() => active),
      };
      manager.registerAdapter({
        platform: 'icqq', supportedTypes: ['reaction'],
        createIndicator: vi.fn().mockReturnValue(indicator),
      });
      const options = {
        platform: 'icqq', endpointKey: 'bot', sessionId: 'group:1',
        messageId: 'message-1', sceneType: 'group' as const,
      };

      const first = manager.start(options);
      let secondSettled = false;
      const second = manager.start(options).then((value) => {
        secondSettled = true;
        return value;
      });
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      releaseStart();
      expect(await second).toBe(await first);
      expect(indicator.start).toHaveBeenCalledTimes(1);
    });

    it('启动未完成时的并发 stop 应共享同一清理', async () => {
      let releaseStart!: () => void;
      const indicator = {
        start: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
          releaseStart = resolve;
        })),
        stop: vi.fn().mockResolvedValue(undefined),
        isActive: vi.fn().mockReturnValue(true),
      };
      manager.registerAdapter({
        platform: 'test', supportedTypes: ['reaction'],
        createIndicator: vi.fn().mockReturnValue(indicator),
      });
      const options = {
        platform: 'test', endpointKey: 'bot', sessionId: 'group:1', sceneType: 'group' as const,
      };

      const starting = manager.start(options);
      const firstStop = manager.stop(options);
      const secondStop = manager.stop(options);
      releaseStart();
      await Promise.all([starting, firstStop, secondStop]);

      expect(indicator.stop).toHaveBeenCalledTimes(1);
    });

    it('不应将分隔符组合不同的 endpoint 键串成同一指示器', async () => {
      const first = {
        start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(),
        isActive: vi.fn().mockReturnValue(true),
      };
      const second = {
        start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(),
        isActive: vi.fn().mockReturnValue(true),
      };
      manager.registerAdapter({
        platform: 'a:b', supportedTypes: ['reaction'],
        createIndicator: vi.fn().mockReturnValue(first),
      });
      manager.registerAdapter({
        platform: 'a', supportedTypes: ['reaction'],
        createIndicator: vi.fn().mockReturnValue(second),
      });

      await manager.start({
        platform: 'a:b', endpointKey: 'c', sessionId: 'd', sceneType: 'private',
      });
      await manager.start({
        platform: 'a', endpointKey: 'b:c', sessionId: 'd', sceneType: 'private',
      });

      expect(first.start).toHaveBeenCalledTimes(1);
      expect(second.start).toHaveBeenCalledTimes(1);
    });
  });
});

describe('NativeTypingIndicator', () => {
  it('停止时应等待已在途的 keepalive，再发送 stopTyping', async () => {
    vi.useFakeTimers();
    let releaseKeepalive!: () => void;
    const startTyping = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseKeepalive = resolve;
      }));
    const stopTyping = vi.fn().mockResolvedValue(undefined);
    const indicator = new NativeTypingIndicator(
      {
        platform: 'test', endpointKey: 'bot', sessionId: 'private:1',
        userId: '1', sceneType: 'private',
      },
      { type: 'typing', platformConfig: { keepaliveIntervalMs: 10 } },
      startTyping,
      stopTyping,
    );

    await indicator.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(startTyping).toHaveBeenCalledTimes(2);
    const stopping = indicator.stop();
    await Promise.resolve();
    expect(stopTyping).not.toHaveBeenCalled();
    releaseKeepalive();
    await stopping;
    expect(stopTyping).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('ReactionTypingIndicator', () => {
  it('应该创建实例', () => {
    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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

  it('stop 等待 removeReaction 完成', async () => {
    const addReaction = vi.fn().mockResolvedValue('reaction-123');
    let resolveRemove!: () => void;
    const removeReaction = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveRemove = resolve; }),
    );

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        endpointKey: '75318',
        messageId: '123456',
        sceneType: 'group',
      },
      { type: 'reaction', emoji: '⏳' },
      addReaction,
      removeReaction,
    );

    await indicator.start();
    let settled = false;
    const stopping = indicator.stop().then(() => { settled = true; });
    await Promise.resolve();
    expect(removeReaction).toHaveBeenCalledTimes(1);
    expect(indicator.isActive()).toBe(false);
    expect(settled).toBe(false);
    resolveRemove();
    await stopping;
    expect(settled).toBe(true);
  });

  it('并发 stop 只应 remove 一次', async () => {
    const addReaction = vi.fn().mockResolvedValue('reaction-123');
    const removeReaction = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20)),
    );

    const indicator = new ReactionTypingIndicator(
      {
        platform: 'icqq',
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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

describe('Endpoint activity feedback capability boundary', () => {
  it('does not use legacy $updateMessage without explicit endpoint edit control', async () => {
    const legacyUpdate = vi.fn().mockResolvedValue(undefined);
    const manager = new AdapterActivityFeedbackManager();
    const endpoint = {
      $id: 'bot',
      control: { recall: vi.fn().mockResolvedValue(undefined) },
      $updateMessage: legacyUpdate,
    };
    const feedback = manager.enableForEndpoint(endpoint as never, 'test', {
      sendMessage: vi.fn().mockResolvedValue('status-1'),
    } as never);
    const options = {
      platform: 'test', endpointKey: 'bot', sessionId: 'group:1',
      groupId: '1', sceneType: 'group' as const,
    };

    const indicator = await feedback.start('active', options, {
      type: 'message', message: 'processing',
    });
    await indicator.update?.('next');

    expect(legacyUpdate).not.toHaveBeenCalled();
    await feedback.stop('active', options);
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
        endpointKey: '75318',
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
        endpointKey: '75318',
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
        endpointKey: '123456',
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
        endpointKey: '123456',
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
    const lifecycle = new DisposeStack();
    const instance = provideTypingIndicatorManager({ lifecycle }, {
      type: 'reaction',
      emoji: '👍',
    });

    expect(instance).toBeDefined();
    void lifecycle.dispose();
  });

  it('generation dispose 应等待活跃提示完成清理', async () => {
    const lifecycle = new DisposeStack();
    const manager = provideTypingIndicatorManager({ lifecycle });
    let releaseStop!: () => void;
    const indicator = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        releaseStop = resolve;
      })),
      isActive: vi.fn().mockReturnValue(true),
    };
    manager.registerAdapter({
      platform: 'test', supportedTypes: ['reaction'],
      createIndicator: vi.fn().mockReturnValue(indicator),
    });
    await manager.start({
      platform: 'test', endpointKey: 'bot', sessionId: 'private:1', sceneType: 'private',
    });

    let disposed = false;
    const disposing = lifecycle.dispose().then(() => { disposed = true; });
    await vi.waitFor(() => expect(indicator.stop).toHaveBeenCalledTimes(1));
    expect(disposed).toBe(false);
    releaseStop();
    await disposing;
    expect(indicator.stop).toHaveBeenCalledTimes(1);
  });
});

describe('便捷函数', () => {
  it('应该快速开始提示', async () => {
    const lifecycle = new DisposeStack();
    const manager = provideTypingIndicatorManager({ lifecycle });

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
      endpointKey: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    expect(mockIndicator.start).toHaveBeenCalled();
  });

  it('应该快速停止提示', async () => {
    const lifecycle = new DisposeStack();
    const manager = provideTypingIndicatorManager({ lifecycle });

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

    await startTypingIndicator({
      platform: 'icqq',
      endpointKey: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    await stopTypingIndicator({
      platform: 'icqq',
      endpointKey: '75318',
      sessionId: 'private:liuchunlang',
      sceneType: 'private',
    });

    expect(mockIndicator.stop).toHaveBeenCalled();
  });
});
