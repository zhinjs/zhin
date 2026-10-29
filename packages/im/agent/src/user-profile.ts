/**
 * UserProfileStore — 会话画像门面
 *
 * 会话画像由三部分组成，都挂在本门面下：
 * - 本表 `ai_user_profiles`：用户显式告诉 Bot 的偏好（key/value）；
 * - `relations`：人物关系与好感度，按 `platform + user_id`（`ai_user_relations`，见 UserRelationStore）；
 * - `sessions`：会话上下文与发言限制，按 `platform + scene_key`（`ai_session_profiles`，见 SessionProfileStore）。
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

import { getLogger } from '@zhin.js/logger';
import { UserRelationStore, sanitizeProfileText } from './user-relation.js';
import { SessionProfileStore } from './session-profile.js';
import { SceneFactStore } from './scene-facts.js';

const logger = getLogger('UserProfile');

// ============================================================================
// 固定维度
// ============================================================================

/**
 * 偏好只有这些固定维度：同一维度覆盖写入，不在表里的键直接拒绝，所以每人最多 8 行、不会无限增长。
 * 顺序即注入顺序。
 */
export const USER_PROFILE_KEYS = [
  'name', 'language', 'timezone', 'style', 'interests', 'dislikes', 'occupation', 'location',
] as const;
export type UserProfileKey = typeof USER_PROFILE_KEYS[number];
/** 每个偏好值的长度上限。 */
export const USER_PROFILE_VALUE_MAX_CHARS = 80;

const USER_PROFILE_KEY_ALIASES: Readonly<Record<string, UserProfileKey>> = {
  preferred_language: 'language',
  lang: 'language',
  tz: 'timezone',
  time_zone: 'timezone',
  reply_style: 'style',
  hobbies: 'interests',
  likes: 'interests',
  job: 'occupation',
  city: 'location',
};

/** 归一化偏好键（大小写、空格、别名）；不是固定维度时返回 null。 */
export function normalizeUserProfileKey(key: unknown): UserProfileKey | null {
  if (typeof key !== 'string') return null;
  const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((USER_PROFILE_KEYS as readonly string[]).includes(normalized)) return normalized as UserProfileKey;
  return USER_PROFILE_KEY_ALIASES[normalized] ?? null;
}

// ============================================================================
// 数据库模型
// ============================================================================

export const AI_USER_PROFILE_MODEL = {
  user_id: { type: 'text' as const, nullable: false },
  key: { type: 'text' as const, nullable: false },
  value: { type: 'text' as const, nullable: false },
  updated_at: { type: 'bigint' as const, default: 0 },
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
  /** 按 platform + userId 合并的画像与好感度（`ai_user_relations`）。 */
  readonly relations: UserRelationStore;
  /** 会话上下文（话题、管理员、成员概况、Bot 发言限制；`ai_session_profiles`）。 */
  readonly sessions: SessionProfileStore;
  /** ADR 0041 §6 场景事实的 L2 缓存（群级事实借 `ai_session_profiles`，成员级事实在 `ai_scene_members`）。 */
  readonly scenes: SceneFactStore;

  constructor(
    relations: UserRelationStore = new UserRelationStore(),
    sessions: SessionProfileStore = new SessionProfileStore(),
  ) {
    this.store = new MemoryProfileStore();
    this.relations = relations;
    this.sessions = sessions;
    this.scenes = new SceneFactStore(sessions);
  }

  upgradeToDatabase(
    model: DbModel,
    relationModel?: Parameters<UserRelationStore['upgradeToDatabase']>[0],
    sessionModel?: Parameters<SessionProfileStore['upgradeToDatabase']>[0],
    sceneMemberModel?: Parameters<SceneFactStore['upgradeToDatabase']>[0],
  ): void {
    const old = this.store;
    this.store = new DatabaseProfileStore(model);
    old.dispose();
    if (relationModel) this.relations.upgradeToDatabase(relationModel);
    if (sessionModel) this.sessions.upgradeToDatabase(sessionModel);
    if (sceneMemberModel) this.scenes.upgradeToDatabase(sceneMemberModel);
    logger.debug('UserProfileStore: upgraded to database storage');
  }

  async get(userId: string, key: string): Promise<string | null> {
    const normalized = normalizeUserProfileKey(key);
    return normalized ? this.store.get(userId, normalized) : null;
  }

  /** 只返回固定维度（旧版本写入的其他键被忽略），按固定顺序。 */
  async getAll(userId: string): Promise<Partial<Record<UserProfileKey, string>>> {
    const stored = await this.store.getAll(userId);
    const result: Partial<Record<UserProfileKey, string>> = {};
    for (const key of USER_PROFILE_KEYS) {
      const value = stored[key];
      if (typeof value === 'string' && value.trim()) result[key] = value;
    }
    return result;
  }

  /**
   * 覆盖写入一个固定维度。键不在 {@link USER_PROFILE_KEYS}（含别名）里、值为空或像敏感信息时拒绝并返回 false；
   * 值超过 {@link USER_PROFILE_VALUE_MAX_CHARS} 会被截断。
   */
  async set(userId: string, key: string, value: string): Promise<boolean> {
    const normalized = normalizeUserProfileKey(key);
    const clean = sanitizeProfileText(value, USER_PROFILE_VALUE_MAX_CHARS);
    if (!normalized || !clean) return false;
    await this.store.set(userId, normalized, clean);
    return true;
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const normalized = normalizeUserProfileKey(key);
    return normalized ? this.store.delete(userId, normalized) : this.store.delete(userId, key);
  }

  /**
   * Build user profile summary for system prompt. Keys like "language" or "preferred_language"
   * define the reply language preference; persona instructions use this for "Reply in the language specified in [User profile]".
   */
  async buildProfileSummary(userId: string): Promise<string> {
    const profile = await this.getAll(userId);
    const entries = Object.entries(profile);
    if (entries.length === 0) return '';

    const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
    return `[User profile]\n${lines}`;
  }

  dispose(): void {
    this.store.dispose();
    this.relations.dispose();
    this.scenes.dispose();
    this.sessions.dispose();
  }
}
