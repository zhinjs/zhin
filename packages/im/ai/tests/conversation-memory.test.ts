/**
 * ConversationMemory 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationMemory } from '@zhin.js/ai';

describe('ConversationMemory（内存模式）', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory({
      minTopicRounds: 5,
      slidingWindowSize: 3,
      topicChangeThreshold: 0.15,
    });
  });

  afterEach(() => {
    memory.dispose();
  });

  describe('saveRound / buildContext', () => {
    it('应保存对话并构建上下文', async () => {
      await memory.saveRound('s1', '你好', '你好呀！');
      await memory.saveRound('s1', '天气怎么样', '今天晴天');

      const context = await memory.buildContext('s1');
      expect(context.length).toBeGreaterThan(0);
      expect(context.some(m => m.content === '你好')).toBe(true);
      expect(context.some(m => m.content === '今天晴天')).toBe(true);
    });

    it('空会话应返回空上下文', async () => {
      const context = await memory.buildContext('nonexistent');
      expect(context).toEqual([]);
    });

    it('轮次应递增', async () => {
      await memory.saveRound('s1', '第一轮', '回复1');
      await memory.saveRound('s1', '第二轮', '回复2');
      await memory.saveRound('s1', '第三轮', '回复3');

      const round = await memory.getCurrentRound('s1');
      expect(round).toBe(3);
    });

    it('upgradeToDatabase 迁移内存中的消息', async () => {
      const mem = new ConversationMemory({ slidingWindowSize: 5, minTopicRounds: 5, topicChangeThreshold: 0.15 });
      await mem.appendPassiveGroupUserMessage('s-migrate', '旁听', { senderId: 'u1' });
      const rows: Array<{ session_id: string; round: number; role: string; content: string; created_at: number }> = [];
      const msgModel = {
        create: async (r: typeof rows[0]) => {
          rows.push(r);
          return r;
        },
        select: async () => rows,
        aggregate: () => ({
          where: (q: { session_id?: string }) => ({
            max: async (_col: string, alias: string) => {
              const sid = q.session_id;
              const matched = sid ? rows.filter((r) => r.session_id === sid) : rows;
              const max = matched.length ? Math.max(...matched.map((r) => r.round)) : 0;
              return [{ [alias]: max }];
            },
          }),
        }),
      };
      const sumModel = {
        create: async () => ({}),
        select: async () => [],
      };
      await mem.upgradeToDatabase(msgModel as any, sumModel as any);
      expect(await mem.hasStoredMessages('s-migrate')).toBe(true);
      expect(rows.some((r) => r.content === '旁听')).toBe(true);
      mem.dispose();
    });

    it('appendPassiveGroupUserMessage 仅写入 user 行供后续 @ 带入', async () => {
      await memory.appendPassiveGroupUserMessage(
        'g1',
        '[sender:id=u2 name=Bob roles=user] 旁听一句',
        { senderId: 'u2', senderRoles: ['user'] },
      );
      await memory.saveRound('g1', '[sender:id=u1 roles=master] @bot 继续', '好的');

      const context = await memory.buildContext('g1');
      expect(context.some(m => m.content.includes('旁听一句'))).toBe(true);
      expect(context.some(m => m.content === '好的')).toBe(true);
      expect(await memory.getCurrentRound('g1')).toBe(2);
    });
  });

  describe('滑动窗口', () => {
    it('应限制上下文到窗口大小', async () => {
      // slidingWindowSize = 3
      await memory.saveRound('s1', 'm1', 'r1');
      await memory.saveRound('s1', 'm2', 'r2');
      await memory.saveRound('s1', 'm3', 'r3');
      await memory.saveRound('s1', 'm4', 'r4');
      await memory.saveRound('s1', 'm5', 'r5');

      const context = await memory.buildContext('s1');
      // 窗口大小 3 → 最多 6 条消息 (3轮 × 2)
      expect(context.length).toBeLessThanOrEqual(6);
      // 不应包含最早的消息
      expect(context.some(m => m.content === 'm1')).toBe(false);
    });
  });

  describe('searchMessages', () => {
    it('应能搜索消息', async () => {
      await memory.saveRound('s1', '今天去打篮球', '好主意');
      await memory.saveRound('s1', '明天去游泳', '注意安全');

      const results = await memory.searchMessages('s1', '篮球');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('篮球');
    });

    it('搜索不到应返回空数组', async () => {
      await memory.saveRound('s1', '你好', '你好');
      const results = await memory.searchMessages('s1', '不存在的内容xyz');
      expect(results).toHaveLength(0);
    });
  });

  describe('getMessagesByRound', () => {
    it('应按轮次范围获取消息', async () => {
      await memory.saveRound('s1', 'm1', 'r1');
      await memory.saveRound('s1', 'm2', 'r2');
      await memory.saveRound('s1', 'm3', 'r3');

      const results = await memory.getMessagesByRound('s1', 1, 2);
      // 第 1-2 轮，每轮 2 条
      expect(results.length).toBe(4);
    });
  });

  describe('traceByKeyword', () => {
    it('无摘要时应直接搜索消息', async () => {
      await memory.saveRound('s1', '讨论编程', '很好');
      await memory.saveRound('s1', '继续编程', '继续');

      const result = await memory.traceByKeyword('s1', '编程');
      expect(result.summary).toBeNull();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  describe('不同会话隔离', () => {
    it('不同 sessionId 的数据应隔离', async () => {
      await memory.saveRound('s1', '会话1', '回复1');
      await memory.saveRound('s2', '会话2', '回复2');

      const ctx1 = await memory.buildContext('s1');
      const ctx2 = await memory.buildContext('s2');

      expect(ctx1.some(m => m.content === '会话1')).toBe(true);
      expect(ctx1.some(m => m.content === '会话2')).toBe(false);
      expect(ctx2.some(m => m.content === '会话2')).toBe(true);
    });
  });

  describe('session 内存缓存淘汰', () => {
    it('定时器应淘汰 24h 未访问的 lastAccess', async () => {
      vi.useFakeTimers();
      const mem = new ConversationMemory({
        minTopicRounds: 5,
        slidingWindowSize: 3,
        topicChangeThreshold: 0.15,
      });
      await mem.saveRound('stale-cache', 'u', 'a');
      const access = (mem as unknown as { lastAccess: Map<string, number> }).lastAccess;
      access.set('stale-cache', Date.now() - 25 * 60 * 60 * 1000);

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(access.has('stale-cache')).toBe(false);
      mem.dispose();
      vi.useRealTimers();
    });
  });

  describe('dispose', () => {
    it('应清理所有数据', async () => {
      await memory.saveRound('s1', '测试', '回复');
      memory.dispose();

      const context = await memory.buildContext('s1');
      expect(context).toEqual([]);
    });
  });
});
