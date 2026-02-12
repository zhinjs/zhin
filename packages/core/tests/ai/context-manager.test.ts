/**
 * Context Manager 测试
 * 
 * 测试上下文管理功能：
 * - 消息记录
 * - 上下文构建
 * - Token 估算
 * - 自动总结
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Logger
vi.mock('@zhin.js/core', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    Logger: class {
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
  };
});

import { ContextManager, createContextManager, CHAT_MESSAGE_MODEL, CONTEXT_SUMMARY_MODEL } from '../../src/ai/context-manager.js';
import type { MessageRecord } from '../../src/ai/context-manager.js';

describe('ContextManager', () => {
  let manager: ContextManager;
  let mockMessageModel: any;
  let mockSummaryModel: any;

  beforeEach(() => {
    // Mock 数据库模型
    const messageStore: MessageRecord[] = [];
    const summaryStore: any[] = [];

    // 链式查询构建器 mock：select().where({...}).orderBy('field', 'DIR').limit(n)
    function createChainableMock(store: any[], filterKey?: string) {
      return vi.fn((..._fields: string[]) => {
        let whereFilter: any = null;
        let orderField: string | null = null;
        let orderDir: string = 'ASC';
        let limitNum: number | null = null;

        const chain: any = {
          where(condition: any) {
            whereFilter = condition;
            return chain;
          },
          orderBy(field: string, dir: string = 'ASC') {
            orderField = field;
            orderDir = dir;
            return chain;
          },
          limit(n: number) {
            limitNum = n;
            return chain;
          },
          then(resolve: (v: any) => any, reject?: (e: any) => any) {
            try {
              let results = [...store];
              if (whereFilter && filterKey) {
                results = results.filter(r => r[filterKey] === whereFilter[filterKey]);
              }
              if (orderField) {
                results.sort((a, b) =>
                  orderDir.toUpperCase() === 'DESC'
                    ? (b[orderField!] ?? 0) - (a[orderField!] ?? 0)
                    : (a[orderField!] ?? 0) - (b[orderField!] ?? 0)
                );
              }
              if (limitNum !== null) {
                results = results.slice(0, limitNum);
              }
              return resolve(results);
            } catch (e) {
              return reject ? reject(e) : Promise.reject(e);
            }
          },
        };
        return chain;
      });
    }

    mockMessageModel = {
      create: vi.fn((record: MessageRecord) => {
        messageStore.push({ ...record, id: messageStore.length + 1 });
        return Promise.resolve();
      }),
      select: createChainableMock(messageStore, 'scene_id'),
      delete: vi.fn(() => Promise.resolve(0)),
    };

    mockSummaryModel = {
      create: vi.fn((record: any) => {
        summaryStore.push({ ...record, id: summaryStore.length + 1 });
        return Promise.resolve();
      }),
      select: createChainableMock(summaryStore, 'scene_id'),
    };

    manager = new ContextManager(mockMessageModel, mockSummaryModel, {
      enabled: true,
      maxRecentMessages: 100,
      summaryThreshold: 50,
    });
  });

  describe('消息记录', () => {
    it('应该记录消息', async () => {
      await manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '测试群',
        sender_id: 'user-1',
        sender_name: '张三',
        message: '你好',
        time: Date.now(),
      });

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'qq',
          scene_id: 'group-123',
          message: '你好',
        })
      );
    });

    it('记录失败时不应抛出错误', async () => {
      mockMessageModel.create.mockRejectedValue(new Error('数据库错误'));

      await expect(manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '',
        sender_id: 'user-1',
        sender_name: '',
        message: '测试',
        time: Date.now(),
      })).resolves.toBeUndefined();
    });
  });

  describe('获取最近消息', () => {
    it('应该获取场景的最近消息', async () => {
      // 添加一些消息
      await manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '测试群',
        sender_id: 'user-1',
        sender_name: '张三',
        message: '消息1',
        time: 1000,
      });

      await manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '测试群',
        sender_id: 'user-2',
        sender_name: '李四',
        message: '消息2',
        time: 2000,
      });

      const messages = await manager.getRecentMessages('group-123');
      
      expect(messages.length).toBe(2);
      // 链式 API: select() 无参数调用
      expect(mockMessageModel.select).toHaveBeenCalled();
    });

    it('空场景应返回空数组', async () => {
      const messages = await manager.getRecentMessages('nonexistent');
      expect(messages).toEqual([]);
    });

    it('应该限制返回数量', async () => {
      const messages = await manager.getRecentMessages('group-123', 10);
      
      // 链式 API: select() 无参数调用，limit 通过链式传递
      expect(mockMessageModel.select).toHaveBeenCalled();
    });
  });

  describe('构建上下文', () => {
    it('应该构建场景上下文', async () => {
      await manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '测试群',
        sender_id: 'user-1',
        sender_name: '张三',
        message: '你好',
        time: Date.now(),
      });

      const context = await manager.buildContext('group-123', 'qq');
      
      expect(context.sceneId).toBe('group-123');
      expect(context.platform).toBe('qq');
      expect(context.chatMessages).toBeDefined();
    });

    it('空场景应返回有效的空上下文', async () => {
      const context = await manager.buildContext('empty-scene', 'qq');
      
      expect(context.sceneId).toBe('empty-scene');
      expect(context.recentMessages).toEqual([]);
      expect(context.summaries).toEqual([]);
    });
  });

  describe('格式化消息', () => {
    it('应该将消息格式化为 ChatMessage', () => {
      const messages: MessageRecord[] = [
        {
          id: 1,
          platform: 'qq',
          scene_id: 'group-123',
          scene_type: 'group',
          scene_name: '测试群',
          sender_id: 'user-1',
          sender_name: '张三',
          message: '你好',
          time: Date.now(),
        },
      ];

      const chatMessages = manager.formatToChatMessages([], messages);
      
      expect(chatMessages.length).toBe(1);
      expect(chatMessages[0].role).toBe('user');
      expect(chatMessages[0].content).toContain('张三');
      expect(chatMessages[0].content).toContain('你好');
    });

    it('应该将总结作为系统消息添加', () => {
      const summaries = ['这是之前的总结'];
      const messages: MessageRecord[] = [];

      const chatMessages = manager.formatToChatMessages(summaries, messages);
      
      expect(chatMessages.length).toBe(1);
      expect(chatMessages[0].role).toBe('system');
      expect(chatMessages[0].content).toContain('这是之前的总结');
    });

    it('应该识别机器人消息', () => {
      const messages: MessageRecord[] = [
        {
          id: 1,
          platform: 'qq',
          scene_id: 'group-123',
          scene_type: 'group',
          scene_name: '',
          sender_id: 'bot-123',
          sender_name: 'MyBot',
          message: '我是机器人',
          time: Date.now(),
        },
      ];

      const chatMessages = manager.formatToChatMessages([], messages);
      
      expect(chatMessages[0].role).toBe('assistant');
    });
  });

  describe('Token 估算', () => {
    it('应该估算中文文本的 token 数量', () => {
      const text = '你好世界'; // 4 个中文字符
      const tokens = manager.estimateTokens(text);
      
      // 中文约 2 tokens/字
      expect(tokens).toBeGreaterThanOrEqual(8);
    });

    it('应该估算英文文本的 token 数量', () => {
      const text = 'hello world'; // 11 个字符
      const tokens = manager.estimateTokens(text);
      
      // 英文约 0.25 tokens/字符
      expect(tokens).toBeGreaterThanOrEqual(2);
    });

    it('应该估算混合文本的 token 数量', () => {
      const text = 'Hello 世界';
      const tokens = manager.estimateTokens(text);
      
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('判断是否需要总结', () => {
    it('消息少于阈值时不需要总结', async () => {
      // 只添加少量消息
      for (let i = 0; i < 5; i++) {
        await manager.recordMessage({
          platform: 'qq',
          scene_id: 'group-123',
          scene_type: 'group',
          scene_name: '',
          sender_id: 'user-1',
          sender_name: 'User',
          message: `消息 ${i}`,
          time: Date.now() + i,
        });
      }

      const shouldSummarize = await manager.shouldSummarize('group-123');
      expect(shouldSummarize).toBe(false);
    });
  });

  describe('总结功能', () => {
    it('没有 AI 提供商时应返回 null', async () => {
      const result = await manager.summarize('group-123');
      expect(result).toBeNull();
    });

    it('设置 AI 提供商后应该能总结', async () => {
      // 添加足够多的消息
      for (let i = 0; i < 60; i++) {
        await manager.recordMessage({
          platform: 'qq',
          scene_id: 'group-123',
          scene_type: 'group',
          scene_name: '',
          sender_id: 'user-1',
          sender_name: 'User',
          message: `消息 ${i}`,
          time: Date.now() + i,
        });
      }

      const mockProvider = {
        models: ['test-model'],
        chat: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '这是总结' } }],
        }),
      };

      manager.setAIProvider(mockProvider as any);
      
      const result = await manager.summarize('group-123');
      
      expect(mockProvider.chat).toHaveBeenCalled();
    });
  });

  describe('场景统计', () => {
    it('应该返回场景统计信息', async () => {
      await manager.recordMessage({
        platform: 'qq',
        scene_id: 'group-123',
        scene_type: 'group',
        scene_name: '',
        sender_id: 'user-1',
        sender_name: 'User',
        message: '测试',
        time: Date.now(),
      });

      const stats = await manager.getSceneStats('group-123');
      
      expect(stats.messageCount).toBeGreaterThan(0);
      expect(stats.summaryCount).toBe(0);
    });

    it('空场景应返回零统计', async () => {
      const stats = await manager.getSceneStats('empty');
      
      expect(stats.messageCount).toBe(0);
      expect(stats.summaryCount).toBe(0);
    });
  });
});

describe('模型定义', () => {
  it('CHAT_MESSAGE_MODEL 应该有正确的字段', () => {
    expect(CHAT_MESSAGE_MODEL.platform).toBeDefined();
    expect(CHAT_MESSAGE_MODEL.scene_id).toBeDefined();
    expect(CHAT_MESSAGE_MODEL.message).toBeDefined();
    expect(CHAT_MESSAGE_MODEL.time).toBeDefined();
  });

  it('CONTEXT_SUMMARY_MODEL 应该有正确的字段', () => {
    expect(CONTEXT_SUMMARY_MODEL.scene_id).toBeDefined();
    expect(CONTEXT_SUMMARY_MODEL.summary).toBeDefined();
    expect(CONTEXT_SUMMARY_MODEL.created_at).toBeDefined();
  });
});

describe('createContextManager', () => {
  it('应该创建 ContextManager 实例', () => {
    const mockModel = { create: vi.fn(), select: vi.fn() };
    const manager = createContextManager(mockModel, mockModel, {
      maxRecentMessages: 50,
    });
    
    expect(manager).toBeInstanceOf(ContextManager);
  });
});
