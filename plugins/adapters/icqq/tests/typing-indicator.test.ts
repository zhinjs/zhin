import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ICQQTypingIndicatorManager,
  createICQQTypingIndicatorManager,
  enableTypingIndicator,
} from '../src/typing-indicator.js';

// Mock IcqqBot
const createMockBot = () => ({
  $id: '75318',
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  $addReaction: vi.fn().mockResolvedValue('reaction-123'),
  $removeReaction: vi.fn().mockResolvedValue(undefined),
  $sendMessage: vi.fn().mockResolvedValue('message-123'),
  $recallMessage: vi.fn().mockResolvedValue(undefined),
  $typingIndicator: undefined as ICQQTypingIndicatorManager | undefined,
});

describe('ICQQTypingIndicatorManager', () => {
  let manager: ICQQTypingIndicatorManager;
  let mockBot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    mockBot = createMockBot();
    manager = new ICQQTypingIndicatorManager(mockBot as any);
  });

  describe('基本功能', () => {
    it('应该创建管理器', () => {
      expect(manager).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const config = manager.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.defaultEmoji).toBe('⏳');
      expect(config.autoRemove).toBe(true);
    });

    it('应该支持自定义配置', () => {
      const customManager = new ICQQTypingIndicatorManager(mockBot as any, {
        enabled: false,
        defaultEmoji: '👍',
      });

      const config = customManager.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.defaultEmoji).toBe('👍');
    });
  });

  describe('消息回应（群聊）', () => {
    it('应该开始消息回应', async () => {
      const indicator = await manager.start({
        messageId: '123456',
        sessionId: 'group:789012',
        sceneType: 'group',
      });

      expect(mockBot.$addReaction).toHaveBeenCalledWith('123456', '⏳');
      expect(indicator.isActive()).toBe(true);
    });

    it('应该停止消息回应', async () => {
      const indicator = await manager.start({
        messageId: '123456',
        sessionId: 'group:789012',
        sceneType: 'group',
      });

      await indicator.stop();

      expect(mockBot.$removeReaction).toHaveBeenCalled();
      expect(indicator.isActive()).toBe(false);
    });

    it('应该处理没有 messageId 的情况', async () => {
      const indicator = await manager.start({
        sessionId: 'group:789012',
        sceneType: 'group',
      });

      // 不应该调用 addReaction
      expect(mockBot.$addReaction).not.toHaveBeenCalled();
    });
  });

  describe('消息提示（私聊）', () => {
    it('应该发送消息提示', async () => {
      const indicator = await manager.start({
        sessionId: 'private:123456',
        userId: '123456',
        sceneType: 'private',
      });

      expect(indicator.isActive()).toBe(true);
    });

    it('应该停止消息提示', async () => {
      const indicator = await manager.start({
        sessionId: 'private:123456',
        userId: '123456',
        sceneType: 'private',
      });

      await indicator.stop();

      expect(indicator.isActive()).toBe(false);
    });
  });

  describe('配置管理', () => {
    it('应该更新配置', () => {
      manager.updateConfig({
        defaultEmoji: '👍',
        autoRemove: false,
      });

      const config = manager.getConfig();
      expect(config.defaultEmoji).toBe('👍');
      expect(config.autoRemove).toBe(false);
    });

    it('应该禁用', async () => {
      manager.updateConfig({ enabled: false });

      const indicator = await manager.start({
        messageId: '123456',
        sessionId: 'group:789012',
        sceneType: 'group',
      });

      // 不应该调用 addReaction
      expect(mockBot.$addReaction).not.toHaveBeenCalled();
      expect(indicator.isActive()).toBe(false);
    });
  });

  describe('停止所有提示', () => {
    it('应该停止所有提示', async () => {
      await manager.start({
        messageId: '123',
        sessionId: 'group:456',
        groupId: '456',
        sceneType: 'group',
      });

      await manager.start({
        sessionId: 'private:789',
        userId: '789',
        sceneType: 'private',
      });

      await manager.stopAll();

      // 应该停止所有提示
      expect(mockBot.$removeReaction).toHaveBeenCalled();
    });
  });
});

describe('createICQQTypingIndicatorManager', () => {
  it('应该创建管理器', () => {
    const mockBot = createMockBot();
    const manager = createICQQTypingIndicatorManager(mockBot as any);

    expect(manager).toBeDefined();
  });

  it('应该支持自定义配置', () => {
    const mockBot = createMockBot();
    const manager = createICQQTypingIndicatorManager(mockBot as any, {
      defaultEmoji: '👍',
    });

    const config = manager.getConfig();
    expect(config.defaultEmoji).toBe('👍');
  });
});

describe('enableTypingIndicator', () => {
  it('应该为 Bot 启用 Typing Indicator', () => {
    const mockBot = createMockBot();
    const manager = enableTypingIndicator(mockBot as any);

    expect(manager).toBeDefined();
    expect(mockBot.$typingIndicator).toBe(manager);
  });

  it('应该复用已有的管理器', () => {
    const mockBot = createMockBot();
    const manager1 = enableTypingIndicator(mockBot as any);
    const manager2 = enableTypingIndicator(mockBot as any);

    expect(manager1).toBe(manager2);
  });

  it('应该支持自定义配置', () => {
    const mockBot = createMockBot();
    const manager = enableTypingIndicator(mockBot as any, {
      defaultEmoji: '👍',
    });

    const config = manager.getConfig();
    expect(config.defaultEmoji).toBe('👍');
  });
});
