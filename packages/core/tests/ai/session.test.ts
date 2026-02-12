/**
 * Session Manager 测试
 * 
 * 测试会话管理功能：
 * - 会话创建和获取
 * - 消息历史管理
 * - 会话超时清理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { 
  MemorySessionManager, 
  DatabaseSessionManager,
  SessionManager, 
  createMemorySessionManager 
} from '../../src/ai/session.js';

describe('MemorySessionManager', () => {
  let manager: MemorySessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new MemorySessionManager({
      maxHistory: 10,
      expireMs: 60000, // 1 分钟
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  describe('会话创建', () => {
    it('应该创建新会话', () => {
      const session = manager.get('user-1');
      
      expect(session).toBeDefined();
      expect(session.id).toBe('user-1');
      expect(session.messages).toEqual([]);
    });

    it('应该返回已存在的会话', () => {
      const session1 = manager.get('user-1');
      manager.addMessage('user-1', { role: 'user', content: 'test' });
      
      const session2 = manager.get('user-1');
      
      expect(session2.messages).toHaveLength(1);
    });

    it('不同用户应该有不同的会话', () => {
      const session1 = manager.get('user-1');
      const session2 = manager.get('user-2');
      
      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('消息历史', () => {
    it('应该添加消息到历史', () => {
      manager.addMessage('user-1', { role: 'user', content: '你好' });
      manager.addMessage('user-1', { role: 'assistant', content: '你好！有什么可以帮你的？' });
      
      const messages = manager.getMessages('user-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('应该限制历史记录数量', () => {
      // 添加超过限制的消息
      for (let i = 0; i < 15; i++) {
        manager.addMessage('user-1', { role: 'user', content: `消息 ${i}` });
      }
      
      const messages = manager.getMessages('user-1');
      expect(messages.length).toBeLessThanOrEqual(10);
    });

    it('系统消息应该保留', () => {
      manager.setSystemPrompt('user-1', '你是一个助手');
      
      for (let i = 0; i < 15; i++) {
        manager.addMessage('user-1', { role: 'user', content: `消息 ${i}` });
      }
      
      const messages = manager.getMessages('user-1');
      const systemMessages = messages.filter(m => m.role === 'system');
      expect(systemMessages.length).toBe(1);
    });
  });

  describe('系统提示', () => {
    it('应该设置系统提示', () => {
      manager.setSystemPrompt('user-1', '你是一个助手');
      
      const messages = manager.getMessages('user-1');
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('你是一个助手');
    });

    it('应该替换旧的系统提示', () => {
      manager.setSystemPrompt('user-1', '旧提示');
      manager.setSystemPrompt('user-1', '新提示');
      
      const messages = manager.getMessages('user-1');
      const systemMessages = messages.filter(m => m.role === 'system');
      expect(systemMessages.length).toBe(1);
      expect(systemMessages[0].content).toBe('新提示');
    });
  });

  describe('会话清理', () => {
    it('应该清除指定会话', () => {
      manager.get('user-1');
      manager.addMessage('user-1', { role: 'user', content: 'test' });
      
      expect(manager.clear('user-1')).toBe(true);
      expect(manager.has('user-1')).toBe(false);
    });

    it('清除不存在的会话应返回 false', () => {
      expect(manager.clear('nonexistent')).toBe(false);
    });

    it('reset 应该保留系统消息', () => {
      manager.setSystemPrompt('user-1', '系统提示');
      manager.addMessage('user-1', { role: 'user', content: 'test' });
      
      manager.reset('user-1');
      
      const messages = manager.getMessages('user-1');
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe('system');
    });
  });

  describe('会话超时', () => {
    it('应该在超时后清理会话', () => {
      manager.get('user-1');
      
      expect(manager.has('user-1')).toBe(true);
      
      // 前进时间超过超时时间
      vi.advanceTimersByTime(61000);
      
      // 触发清理
      manager.cleanup();
      
      expect(manager.has('user-1')).toBe(false);
    });

    it('活动会话不应该被清理', () => {
      manager.get('user-1');
      
      // 前进一半时间
      vi.advanceTimersByTime(30000);
      
      // 添加新消息（刷新活动时间）
      manager.addMessage('user-1', { role: 'user', content: '新消息' });
      
      // 再前进一半时间
      vi.advanceTimersByTime(30000);
      
      manager.cleanup();
      
      // 会话应该还在
      expect(manager.has('user-1')).toBe(true);
    });
  });

  describe('统计信息', () => {
    it('应该返回正确的统计信息', () => {
      manager.get('user-1');
      manager.get('user-2');
      
      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.expired).toBe(0);
    });

    it('应该返回会话列表', () => {
      manager.get('user-1');
      manager.get('user-2');
      manager.get('user-3');
      
      const sessions = manager.listSessions();
      expect(sessions).toContain('user-1');
      expect(sessions).toContain('user-2');
      expect(sessions).toContain('user-3');
    });
  });

  describe('dispose', () => {
    it('应该清理所有会话', () => {
      manager.get('user-1');
      manager.get('user-2');
      
      manager.dispose();
      
      expect(manager.has('user-1')).toBe(false);
      expect(manager.has('user-2')).toBe(false);
    });
  });
});

describe('SessionManager', () => {
  describe('generateId', () => {
    it('应该生成正确的会话 ID（带频道）', () => {
      const id = SessionManager.generateId('qq', 'user123', 'channel456');
      expect(id).toBe('qq:channel456:user123');
    });

    it('应该生成正确的会话 ID（无频道）', () => {
      const id = SessionManager.generateId('telegram', 'user123');
      expect(id).toBe('telegram:user123');
    });
  });
});

describe('createMemorySessionManager', () => {
  it('应该创建 SessionManager 实例', () => {
    const manager = createMemorySessionManager({ maxHistory: 50 });
    expect(manager).toBeDefined();
    expect(manager.get).toBeDefined();
    manager.dispose();
  });
});

describe('DatabaseSessionManager', () => {
  // Mock 数据库模型
  function createMockModel(records: any[] = []) {
    return {
      select: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(records),
      }),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadSession JSON 解析', () => {
    it('应该解析字符串形式的 messages (JSON)', async () => {
      const messagesJson = JSON.stringify([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);
      const model = createMockModel([{
        session_id: 'test-1',
        messages: messagesJson,
        config: JSON.stringify({ provider: 'ollama' }),
        created_at: 1000,
        updated_at: 2000,
      }]);

      const manager = new DatabaseSessionManager(model);
      const session = await manager.get('test-1');

      expect(Array.isArray(session.messages)).toBe(true);
      expect(session.messages).toHaveLength(2);
      expect(session.messages[0]).toEqual({ role: 'user', content: 'hello' });
      manager.dispose();
    });

    it('应该解析字符串形式的 config (JSON)', async () => {
      const model = createMockModel([{
        session_id: 'test-2',
        messages: '[]',
        config: '{"provider":"ollama","maxHistory":100}',
        created_at: 1000,
        updated_at: 2000,
      }]);

      const manager = new DatabaseSessionManager(model);
      const session = await manager.get('test-2');

      expect(typeof session.config).toBe('object');
      expect(session.config).toEqual({ provider: 'ollama', maxHistory: 100 });
      manager.dispose();
    });

    it('messages 已是数组时不应二次解析', async () => {
      const messagesArray = [{ role: 'system', content: 'You are a bot' }];
      const model = createMockModel([{
        session_id: 'test-3',
        messages: messagesArray,
        config: { provider: 'openai' },
        created_at: 1000,
        updated_at: 2000,
      }]);

      const manager = new DatabaseSessionManager(model);
      const session = await manager.get('test-3');

      expect(session.messages).toBe(messagesArray);
      expect(session.config).toEqual({ provider: 'openai' });
      manager.dispose();
    });

    it('加载后的 messages 应支持 push 操作', async () => {
      const model = createMockModel([{
        session_id: 'test-4',
        messages: '[{"role":"user","content":"hi"}]',
        config: '{"provider":"openai"}',
        created_at: 1000,
        updated_at: 2000,
      }]);

      const manager = new DatabaseSessionManager(model);
      // addMessage 内部调用 session.messages.push
      await manager.addMessage('test-4', { role: 'assistant', content: 'hello!' });

      const session = await manager.get('test-4');
      expect(session.messages).toHaveLength(2);
      expect(session.messages[1]).toEqual({ role: 'assistant', content: 'hello!' });
      manager.dispose();
    });

    it('messages 或 config 为 null/undefined 时应使用默认值', async () => {
      const model = createMockModel([{
        session_id: 'test-5',
        messages: null,
        config: null,
        created_at: 1000,
        updated_at: 2000,
      }]);

      const manager = new DatabaseSessionManager(model);
      const session = await manager.get('test-5');

      expect(Array.isArray(session.messages)).toBe(true);
      expect(session.messages).toHaveLength(0);
      expect(session.config).toEqual({ provider: 'openai' });
      manager.dispose();
    });
  });

  describe('新会话创建', () => {
    it('数据库无记录时应创建新会话', async () => {
      const model = createMockModel([]); // 空结果
      const manager = new DatabaseSessionManager(model);
      const session = await manager.get('new-session');

      expect(session.id).toBe('new-session');
      expect(Array.isArray(session.messages)).toBe(true);
      expect(session.messages).toHaveLength(0);
      manager.dispose();
    });
  });
});
