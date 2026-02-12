/**
 * UserProfileStore — 用户画像存储
 *
 * 持久化存储用户偏好和特征，让 AI 跨会话记住用户的个性化信息。
 *
 *   ai_user_profiles 表：
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ user_id  | key          | value         | updated_at     │
 *   │ u1       | name         | 小明          | 1700000000     │
 *   │ u1       | style        | 简洁正式      | 1700000001     │
 *   │ u1       | interests    | 编程,天气     | 1700000010     │
 *   └──────────────────────────────────────────────────────────┘
 */

import { Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'UserProfile');

// ============================================================================
// 数据库模型
// ============================================================================

export const AI_USER_PROFILE_MODEL = {
  user_id: { type: 'text' as const, nullable: false },
  key: { type: 'text' as const, nullable: false },
  value: { type: 'text' as const, nullable: false },
  updated_at: { type: 'integer' as const, default: 0 },
};

// ============================================================================
// 类型
// ============================================================================

interface ProfileRecord {
  id?: number;
  user_id: string;
  key: string;
  value: string;
  updated_at: number;
}

/**
 * 数据库模型接口（与 RelatedModel 的链式查询 API 对齐）
 */
interface DbModel {
  select(...fields: string[]): any;  // 返回 Selection (thenable, 支持 .where())
  create(data: Record<string, any>): Promise<any>;
  update(data: Partial<any>): any;   // 返回 Updation (thenable, 支持 .where())
  delete(condition: Record<string, any>): any; // 返回 Deletion (thenable, 支持 .where())
}

// ============================================================================
// Store 接口
// ============================================================================

interface IProfileStore {
  get(userId: string, key: string): Promise<string | null>;
  getAll(userId: string): Promise<Record<string, string>>;
  set(userId: string, key: string, value: string): Promise<void>;
  delete(userId: string, key: string): Promise<boolean>;
  dispose(): void;
}

// ============================================================================
// 内存实现
// ============================================================================

class MemoryProfileStore implements IProfileStore {
  private data: Map<string, Map<string, string>> = new Map();

  async get(userId: string, key: string): Promise<string | null> {
    return this.data.get(userId)?.get(key) ?? null;
  }

  async getAll(userId: string): Promise<Record<string, string>> {
    const map = this.data.get(userId);
    if (!map) return {};
    return Object.fromEntries(map);
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    let map = this.data.get(userId);
    if (!map) { map = new Map(); this.data.set(userId, map); }
    map.set(key, value);
  }

  async delete(userId: string, key: string): Promise<boolean> {
    return this.data.get(userId)?.delete(key) ?? false;
  }

  dispose(): void { this.data.clear(); }
}

// ============================================================================
// 数据库实现
// ============================================================================

class DatabaseProfileStore implements IProfileStore {
  constructor(private model: DbModel) {}

  async get(userId: string, key: string): Promise<string | null> {
    const records = await this.model.select().where({ user_id: userId, key }) as ProfileRecord[];
    return records.length > 0 ? records[0].value : null;
  }

  async getAll(userId: string): Promise<Record<string, string>> {
    const records = await this.model.select().where({ user_id: userId }) as ProfileRecord[];
    const result: Record<string, string> = {};
    for (const r of records) result[r.key] = r.value;
    return result;
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    const existing = await this.model.select().where({ user_id: userId, key });
    if (existing.length > 0) {
      await this.model.update({ value, updated_at: Date.now() }).where({ user_id: userId, key });
    } else {
      await this.model.create({ user_id: userId, key, value, updated_at: Date.now() });
    }
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const existing = await this.model.select().where({ user_id: userId, key });
    if (existing.length === 0) return false;
    await this.model.delete({ user_id: userId, key });
    return true;
  }

  dispose(): void {}
}

// ============================================================================
// UserProfileStore
// ============================================================================

export class UserProfileStore {
  private store: IProfileStore;

  constructor() {
    this.store = new MemoryProfileStore();
  }

  upgradeToDatabase(model: DbModel): void {
    const old = this.store;
    this.store = new DatabaseProfileStore(model);
    old.dispose();
    logger.debug('UserProfileStore: upgraded to database storage');
  }

  async get(userId: string, key: string): Promise<string | null> {
    return this.store.get(userId, key);
  }

  async getAll(userId: string): Promise<Record<string, string>> {
    return this.store.getAll(userId);
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    return this.store.set(userId, key, value);
  }

  async delete(userId: string, key: string): Promise<boolean> {
    return this.store.delete(userId, key);
  }

  /**
   * 构建用户画像摘要，注入 system prompt
   */
  async buildProfileSummary(userId: string): Promise<string> {
    const profile = await this.store.getAll(userId);
    const entries = Object.entries(profile);
    if (entries.length === 0) return '';

    const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
    return `[用户画像]\n${lines}`;
  }

  dispose(): void {
    this.store.dispose();
  }
}
