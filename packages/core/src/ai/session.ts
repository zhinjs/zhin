/**
 * @zhin.js/ai - Session Manager
 * 会话管理器，支持上下文记忆和数据库持久化
 * 
 * 特性：
 * - 数据库持久化存储（使用 Zhin 的数据库服务）
 * - 内存缓存加速读取
 * - 自动过期清理
 * - 更长的上下文记忆能力
 */

import { Logger } from '@zhin.js/logger';
import type { ChatMessage, SessionConfig, Session } from './types.js';

const logger = new Logger(null, 'AI-Session');

/**
 * 数据库模型定义
 */
export const AI_SESSION_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  messages: { type: 'json' as const, default: [] },
  config: { type: 'json' as const, default: {} },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

/**
 * 数据库会话记录
 */
interface SessionRecord {
  id?: number;
  session_id: string;
  messages: ChatMessage[];
  config: SessionConfig;
  created_at: number;
  updated_at: number;
}

/**
 * 会话管理器接口
 */
export interface ISessionManager {
  get(sessionId: string, config?: SessionConfig): Session | Promise<Session>;
  has(sessionId: string): boolean | Promise<boolean>;
  addMessage(sessionId: string, message: ChatMessage): void | Promise<void>;
  getMessages(sessionId: string): ChatMessage[] | Promise<ChatMessage[]>;
  setSystemPrompt(sessionId: string, prompt: string): void | Promise<void>;
  clear(sessionId: string): boolean | Promise<boolean>;
  reset(sessionId: string): void | Promise<void>;
  listSessions(): string[] | Promise<string[]>;
  getStats(): { total: number; active: number; expired: number } | Promise<{ total: number; active: number; expired: number }>;
  cleanup(): number | Promise<number>;
  dispose(): void | Promise<void>;
}

/**
 * 内存会话管理器（回退方案）
 */
export class MemorySessionManager implements ISessionManager {
  private sessions: Map<string, Session> = new Map();
  private config: Required<Pick<SessionConfig, 'maxHistory' | 'expireMs'>>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: { maxHistory?: number; expireMs?: number } = {}) {
    this.config = {
      maxHistory: config.maxHistory ?? 100,
      expireMs: config.expireMs ?? 24 * 60 * 60 * 1000, // 24 小时
    };

    // 定期清理过期会话
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  get(sessionId: string, config?: SessionConfig): Session {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        config: config || { provider: 'openai' },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    } else {
      session.updatedAt = Date.now();
    }

    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.get(sessionId);
    session.messages.push(message);
    session.updatedAt = Date.now();
    this.trimMessages(session);
  }

  private trimMessages(session: Session): void {
    const maxHistory = session.config.maxHistory ?? this.config.maxHistory;
    if (session.messages.length > maxHistory) {
      const systemMessages = session.messages.filter(m => m.role === 'system');
      const otherMessages = session.messages.filter(m => m.role !== 'system');
      const keepCount = maxHistory - systemMessages.length;
      session.messages = [...systemMessages, ...otherMessages.slice(-keepCount)];
    }
  }

  getMessages(sessionId: string): ChatMessage[] {
    return this.sessions.get(sessionId)?.messages || [];
  }

  setSystemPrompt(sessionId: string, prompt: string): void {
    const session = this.get(sessionId);
    session.messages = session.messages.filter(m => m.role !== 'system');
    session.messages.unshift({ role: 'system', content: prompt });
    session.updatedAt = Date.now();
  }

  clear(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  reset(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const systemMessages = session.messages.filter(m => m.role === 'system');
      session.messages = systemMessages;
      session.updatedAt = Date.now();
    }
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  getStats(): { total: number; active: number; expired: number } {
    const now = Date.now();
    let active = 0;
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (now - session.updatedAt > this.config.expireMs) {
        expired++;
      } else {
        active++;
      }
    }

    return { total: this.sessions.size, active, expired };
  }

  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      const expireMs = session.config.expireMs ?? this.config.expireMs;
      if (now - session.updatedAt > expireMs) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.sessions.clear();
  }
}

/**
 * 数据库会话管理器
 * 使用 Zhin 的数据库服务进行持久化存储
 */
export class DatabaseSessionManager implements ISessionManager {
  private cache: Map<string, Session> = new Map();
  private config: Required<Pick<SessionConfig, 'maxHistory' | 'expireMs'>>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private saveQueue: Map<string, Session> = new Map();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private model: any; // 数据库模型

  constructor(
    model: any,
    config: { maxHistory?: number; expireMs?: number } = {}
  ) {
    this.model = model;
    this.config = {
      maxHistory: config.maxHistory ?? 200, // 数据库支持更长的历史
      expireMs: config.expireMs ?? 7 * 24 * 60 * 60 * 1000, // 7 天过期
    };

    // 定期清理过期会话（每小时）
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * 从数据库加载会话
   */
  private async loadSession(sessionId: string): Promise<Session | null> {
    try {
      const records = await this.model.select().where({ session_id: sessionId });
      if (records && records.length > 0) {
        const record = records[0] as SessionRecord;
        // SQLite 中 json 类型存储为 TEXT，读回时需要解析
        const messages = typeof record.messages === 'string'
          ? JSON.parse(record.messages)
          : (record.messages || []);
        const config = typeof record.config === 'string'
          ? JSON.parse(record.config)
          : (record.config || { provider: 'openai' });
        return {
          id: record.session_id,
          config: Array.isArray(config) ? { provider: 'openai' } : config,
          messages: Array.isArray(messages) ? messages : [],
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        };
      }
    } catch (error) {
      logger.debug('加载会话失败:', error);
    }
    return null;
  }

  /**
   * 保存会话到数据库（防抖）
   */
  private schedulesSave(session: Session): void {
    this.saveQueue.set(session.id, session);

    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => this.flushSaveQueue(), 1000);
    }
  }

  /**
   * 批量保存队列中的会话
   */
  private async flushSaveQueue(): Promise<void> {
    this.saveTimer = undefined;

    const sessions = Array.from(this.saveQueue.values());
    this.saveQueue.clear();

    for (const session of sessions) {
      try {
        const existing = await this.model.select().where({ session_id: session.id });
        const record: Partial<SessionRecord> = {
          session_id: session.id,
          messages: session.messages,
          config: session.config,
          updated_at: session.updatedAt,
        };

        if (existing && existing.length > 0) {
          await this.model.update(record).where({ session_id: session.id });
        } else {
          record.created_at = session.createdAt;
          await this.model.create(record);
        }
      } catch (error) {
        logger.debug(`保存会话 ${session.id} 失败:`, error);
      }
    }
  }

  async get(sessionId: string, config?: SessionConfig): Promise<Session> {
    // 先检查缓存
    let session = this.cache.get(sessionId);

    if (!session) {
      // 从数据库加载
      session = await this.loadSession(sessionId) ?? undefined;

      if (!session) {
        // 创建新会话
        session = {
          id: sessionId,
          config: config || { provider: 'openai' },
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      this.cache.set(sessionId, session);
    }

    session.updatedAt = Date.now();
    this.schedulesSave(session);

    return session;
  }

  async has(sessionId: string): Promise<boolean> {
    if (this.cache.has(sessionId)) {
      return true;
    }

    try {
      const records = await this.model.select().where({ session_id: sessionId });
      return records && records.length > 0;
    } catch {
      return false;
    }
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = await this.get(sessionId);
    session.messages.push(message);
    session.updatedAt = Date.now();
    this.trimMessages(session);
    this.schedulesSave(session);
  }

  private trimMessages(session: Session): void {
    const maxHistory = session.config.maxHistory ?? this.config.maxHistory;
    if (session.messages.length > maxHistory) {
      const systemMessages = session.messages.filter(m => m.role === 'system');
      const otherMessages = session.messages.filter(m => m.role !== 'system');
      const keepCount = maxHistory - systemMessages.length;
      session.messages = [...systemMessages, ...otherMessages.slice(-keepCount)];
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const session = await this.get(sessionId);
    return session.messages;
  }

  async setSystemPrompt(sessionId: string, prompt: string): Promise<void> {
    const session = await this.get(sessionId);
    session.messages = session.messages.filter(m => m.role !== 'system');
    session.messages.unshift({ role: 'system', content: prompt });
    session.updatedAt = Date.now();
    this.schedulesSave(session);
  }

  async clear(sessionId: string): Promise<boolean> {
    this.cache.delete(sessionId);
    this.saveQueue.delete(sessionId);

    try {
      await this.model.delete({ session_id: sessionId });
      return true;
    } catch (error) {
      logger.debug(`删除会话 ${sessionId} 失败:`, error);
      return false;
    }
  }

  async reset(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    const systemMessages = session.messages.filter(m => m.role === 'system');
    session.messages = systemMessages;
    session.updatedAt = Date.now();
    this.schedulesSave(session);
  }

  async listSessions(): Promise<string[]> {
    try {
      const records = await this.model.select();
      return (records as SessionRecord[]).map(r => r.session_id);
    } catch (error) {
      logger.debug('列出会话失败:', error);
      return Array.from(this.cache.keys());
    }
  }

  async getStats(): Promise<{ total: number; active: number; expired: number }> {
    const now = Date.now();
    let total = 0;
    let active = 0;
    let expired = 0;

    try {
      const records = await this.model.select() as SessionRecord[];
      total = records.length;

      for (const record of records) {
        const expireMs = record.config?.expireMs ?? this.config.expireMs;
        if (now - record.updated_at > expireMs) {
          expired++;
        } else {
          active++;
        }
      }
    } catch (error) {
      logger.debug('获取统计失败:', error);
      // 回退到缓存统计
      total = this.cache.size;
      for (const session of this.cache.values()) {
        if (now - session.updatedAt > this.config.expireMs) {
          expired++;
        } else {
          active++;
        }
      }
    }

    return { total, active, expired };
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    try {
      const records = await this.model.select() as SessionRecord[];

      for (const record of records) {
        const expireMs = record.config?.expireMs ?? this.config.expireMs;
        if (now - record.updated_at > expireMs) {
          await this.model.delete({ session_id: record.session_id });
          this.cache.delete(record.session_id);
          cleaned++;
        }
      }
    } catch (error) {
      logger.debug('清理会话失败:', error);
    }

    return cleaned;
  }

  async dispose(): Promise<void> {
    // 保存所有待保存的会话
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.flushSaveQueue();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.cache.clear();
  }
}

/**
 * 会话管理器包装器
 * 支持同步和异步接口的统一使用
 */
export class SessionManager implements ISessionManager {
  private manager: ISessionManager;

  constructor(manager: ISessionManager) {
    this.manager = manager;
  }

  /**
   * 生成会话 ID
   */
  static generateId(platform: string, userId: string, channelId?: string): string {
    return channelId 
      ? `${platform}:${channelId}:${userId}`
      : `${platform}:${userId}`;
  }

  get(sessionId: string, config?: SessionConfig): Session | Promise<Session> {
    return this.manager.get(sessionId, config);
  }

  has(sessionId: string): boolean | Promise<boolean> {
    return this.manager.has(sessionId);
  }

  addMessage(sessionId: string, message: ChatMessage): void | Promise<void> {
    return this.manager.addMessage(sessionId, message);
  }

  getMessages(sessionId: string): ChatMessage[] | Promise<ChatMessage[]> {
    return this.manager.getMessages(sessionId);
  }

  setSystemPrompt(sessionId: string, prompt: string): void | Promise<void> {
    return this.manager.setSystemPrompt(sessionId, prompt);
  }

  clear(sessionId: string): boolean | Promise<boolean> {
    return this.manager.clear(sessionId);
  }

  reset(sessionId: string): void | Promise<void> {
    return this.manager.reset(sessionId);
  }

  listSessions(): string[] | Promise<string[]> {
    return this.manager.listSessions();
  }

  getStats(): { total: number; active: number; expired: number } | Promise<{ total: number; active: number; expired: number }> {
    return this.manager.getStats();
  }

  cleanup(): number | Promise<number> {
    return this.manager.cleanup();
  }

  dispose(): void | Promise<void> {
    return this.manager.dispose();
  }
}

/**
 * 创建内存会话管理器（回退方案）
 */
export function createMemorySessionManager(config?: { maxHistory?: number; expireMs?: number }): SessionManager {
  return new SessionManager(new MemorySessionManager(config));
}

/**
 * 创建数据库会话管理器
 */
export function createDatabaseSessionManager(
  model: any,
  config?: { maxHistory?: number; expireMs?: number }
): SessionManager {
  return new SessionManager(new DatabaseSessionManager(model, config));
}

/**
 * 创建会话管理器（向后兼容）
 * @deprecated 使用 createMemorySessionManager 或 createDatabaseSessionManager
 */
export function createSessionManager(config?: { maxHistory?: number; expireMs?: number }): SessionManager {
  return createMemorySessionManager(config);
}
