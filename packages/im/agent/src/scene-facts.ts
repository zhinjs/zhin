/**
 * SceneFactStore — ADR 0041 §6 场景事实的二级缓存（L2，持久）。
 *
 * - 群级事实（名称、群主、管理员、人数、全员禁言、Bot 角色 / 禁言）在 `ai_session_profiles`
 *   （{@link SessionProfileStore}，列 `owner_id` / `member_count` / `facts_updated_at` 为本 ADR 新增）；
 * - 成员级事实（平台角色、群名片、头衔、禁言到期）在 `ai_scene_members`，一行 = 一个会话里的一个成员。
 *
 * 读：宿主先查内存 L1（60 s），再查本 store，最后才问平台；平台结果同时写 L1 与 L2。
 * 写穿：成员 / 群的侧事件直接更新这里（只改已有基线的行，不凭增量造事实）。
 *
 * 落盘有界（不浪费用户磁盘）：成员离开即删；{@link SCENE_MEMBER_RETENTION_MS} 内没更新的行删除；
 * 每会话至多 {@link SCENE_MEMBER_MAX_PER_SCENE} 行（淘汰最旧的 `updated_at`）；
 * 启动时与每 {@link SCENE_FACT_PRUNE_INTERVAL_MS} 清理一次。存储的文本一律去控制字符并截断到 128 字符。
 *
 * 逻辑主键 `platform + scene_key + user_id`：库层只支持单列主键，唯一性由本 store 的串行写入保证。
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  cleanSceneFactText,
  sceneGroupFactsOf,
  sceneKeyOf,
  type BotSceneRole,
  type SceneGroupChange,
  type SceneGroupFactsInput,
  type SessionProfileStore,
  type SessionScope,
} from './session-profile.js';

const logger = getLogger('SceneFacts');

export const AI_SCENE_MEMBERS_TABLE = 'ai_scene_members';

export const AI_SCENE_MEMBER_MODEL = {
  platform: { type: 'text' as const, nullable: false },
  scene_key: { type: 'text' as const, nullable: false },
  user_id: { type: 'text' as const, nullable: false },
  platform_role: { type: 'text' as const, default: '' },
  card: { type: 'text' as const, default: '' },
  title: { type: 'text' as const, default: '' },
  /** 禁言到期（毫秒）；0 = 确认未禁言；NULL = 未知。 */
  muted_until: { type: 'bigint' as const, nullable: true },
  updated_at: { type: 'bigint' as const, default: 0 },
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 成员行超过这个时间没被更新就删除。 */
export const SCENE_MEMBER_RETENTION_MS = 90 * DAY_MS;
/** 每个会话最多保留的成员行。 */
export const SCENE_MEMBER_MAX_PER_SCENE = 2000;
/** 启动之后的定期清理间隔。 */
export const SCENE_FACT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** L2 行超过这个年龄仍然可读，但会触发一次后台刷新。 */
export const SCENE_FACT_STALE_MS = DAY_MS;
/** 内容未变的成员行，`updated_at` 至多每 5 分钟刷新一次（减少写库）。 */
export const SCENE_MEMBER_TOUCH_MS = 5 * 60 * 1000;
/** 同一会话新增这么多行后顺带核对一次上限（其余由定期清理兜底）。 */
const CAP_CHECK_EVERY = 50;

export type SceneMemberRole = 'owner' | 'admin' | 'member';

/** 平台一次读取的成员事实（字段缺省 = 未知）。 */
export interface SceneMemberFacts {
  readonly platformRole?: SceneMemberRole;
  readonly card?: string;
  readonly title?: string;
  /** 0 = 确认未禁言；正数 = 禁言到期（毫秒）。 */
  readonly mutedUntil?: number;
}

/** 侧事件带来的成员级增量（只改给出的字段）。 */
export interface SceneMemberChange {
  readonly platformRole?: SceneMemberRole;
  readonly card?: string;
  readonly title?: string;
  readonly mutedUntil?: number;
}

export interface SceneMemberRecord {
  readonly platform: string;
  readonly sceneKey: string;
  readonly userId: string;
  readonly facts: SceneMemberFacts;
  readonly updatedAt: number;
}

export interface ScenePruneResult {
  readonly expired: number;
  readonly evicted: number;
}

interface DbModel {
  select(...fields: string[]): { where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]> };
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
  delete(): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

interface MemberKey { readonly platform: string; readonly sceneKey: string; readonly userId: string }
interface MemberStamp extends MemberKey { readonly updatedAt: number }

interface MemberBackend {
  load(key: MemberKey): Promise<SceneMemberRecord | null>;
  insert(record: SceneMemberRecord): Promise<void>;
  update(record: SceneMemberRecord): Promise<void>;
  remove(key: MemberKey): Promise<void>;
  removeOlderThan(cutoff: number): Promise<number>;
  listScene(platform: string, sceneKey: string): Promise<MemberStamp[]>;
  listAll(): Promise<MemberStamp[]>;
  dispose(): void;
}

const SEP = '\u0000';
const keyOf = (key: MemberKey) => `${key.platform}${SEP}${key.sceneKey}${SEP}${key.userId}`;

function isRole(value: unknown): value is SceneMemberRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function memberFromRow(row: Record<string, unknown>): SceneMemberRecord {
  const card = String(row.card ?? '');
  const title = String(row.title ?? '');
  const muted = row.muted_until === null || row.muted_until === undefined ? undefined : Number(row.muted_until);
  return {
    platform: String(row.platform),
    sceneKey: String(row.scene_key),
    userId: String(row.user_id),
    facts: {
      ...(isRole(row.platform_role) ? { platformRole: row.platform_role } : {}),
      ...(card ? { card } : {}),
      ...(title ? { title } : {}),
      ...(muted !== undefined && Number.isFinite(muted) ? { mutedUntil: muted } : {}),
    },
    updatedAt: Number(row.updated_at ?? 0) || 0,
  };
}

function memberToRow(record: SceneMemberRecord): Record<string, unknown> {
  return {
    platform: record.platform,
    scene_key: record.sceneKey,
    user_id: record.userId,
    platform_role: record.facts.platformRole ?? '',
    card: record.facts.card ?? '',
    title: record.facts.title ?? '',
    muted_until: record.facts.mutedUntil ?? null,
    updated_at: record.updatedAt,
  };
}

class MemoryMemberBackend implements MemberBackend {
  readonly #rows = new Map<string, SceneMemberRecord>();
  async load(key: MemberKey) { return this.#rows.get(keyOf(key)) ?? null; }
  async insert(record: SceneMemberRecord) { this.#rows.set(keyOf(record), record); }
  async update(record: SceneMemberRecord) { this.#rows.set(keyOf(record), record); }
  async remove(key: MemberKey) { this.#rows.delete(keyOf(key)); }
  async removeOlderThan(cutoff: number) {
    let removed = 0;
    for (const [key, row] of this.#rows) {
      if (row.updatedAt < cutoff) { this.#rows.delete(key); removed += 1; }
    }
    return removed;
  }
  async listScene(platform: string, sceneKey: string) {
    return [...this.#rows.values()].filter((row) => row.platform === platform && row.sceneKey === sceneKey);
  }
  async listAll() { return [...this.#rows.values()]; }
  dispose() { this.#rows.clear(); }
}

class DatabaseMemberBackend implements MemberBackend {
  constructor(private readonly model: DbModel) {}
  async load(key: MemberKey) {
    const rows = await this.model.select().where({ platform: key.platform, scene_key: key.sceneKey, user_id: key.userId });
    return rows.length > 0 ? memberFromRow(rows[0]!) : null;
  }
  async insert(record: SceneMemberRecord) { await this.model.create(memberToRow(record)); }
  async update(record: SceneMemberRecord) {
    const { platform, scene_key, user_id, ...rest } = memberToRow(record);
    await this.model.update(rest).where({ platform, scene_key, user_id });
  }
  async remove(key: MemberKey) {
    await this.model.delete().where({ platform: key.platform, scene_key: key.sceneKey, user_id: key.userId });
  }
  async removeOlderThan(cutoff: number) {
    const old = await this.model.select('platform', 'scene_key', 'user_id', 'updated_at').where({ updated_at: { $lt: cutoff } });
    if (old.length === 0) return 0;
    await this.model.delete().where({ updated_at: { $lt: cutoff } });
    return old.length;
  }
  async listScene(platform: string, sceneKey: string) {
    const rows = await this.model.select('platform', 'scene_key', 'user_id', 'updated_at').where({ platform, scene_key: sceneKey });
    return rows.map(stampOf);
  }
  async listAll() {
    const rows = await this.model.select('platform', 'scene_key', 'user_id', 'updated_at').where({ updated_at: { $gte: 0 } });
    return rows.map(stampOf);
  }
  dispose() {}
}

function stampOf(row: Record<string, unknown>): MemberStamp {
  return {
    platform: String(row.platform), sceneKey: String(row.scene_key), userId: String(row.user_id),
    updatedAt: Number(row.updated_at ?? 0) || 0,
  };
}

function cleanFacts(facts: SceneMemberFacts): SceneMemberFacts {
  const card = cleanSceneFactText(facts.card);
  const title = cleanSceneFactText(facts.title);
  const muted = facts.mutedUntil;
  return {
    ...(isRole(facts.platformRole) ? { platformRole: facts.platformRole } : {}),
    ...(card ? { card } : {}),
    ...(title ? { title } : {}),
    ...(typeof muted === 'number' && Number.isFinite(muted) ? { mutedUntil: Math.max(0, Math.floor(muted)) } : {}),
  };
}

function sameFacts(left: SceneMemberFacts, right: SceneMemberFacts): boolean {
  return left.platformRole === right.platformRole && left.card === right.card
    && left.title === right.title && left.mutedUntil === right.mutedUntil;
}

export interface SceneFactStoreOptions {
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly maxPerScene?: number;
}

export class SceneFactStore {
  #backend: MemberBackend = new MemoryMemberBackend();
  #writes: Promise<unknown> = Promise.resolve();
  readonly #inserts = new Map<string, number>();
  readonly #now: () => number;
  readonly #retentionMs: number;
  readonly #maxPerScene: number;
  #persistent = false;
  #disposed = false;

  constructor(private readonly sessions: SessionProfileStore, options: SceneFactStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#retentionMs = options.retentionMs ?? SCENE_MEMBER_RETENTION_MS;
    this.#maxPerScene = options.maxPerScene ?? SCENE_MEMBER_MAX_PER_SCENE;
  }

  get persistent(): boolean { return this.#persistent; }

  upgradeToDatabase(model: DbModel): void {
    const old = this.#backend;
    this.#backend = new DatabaseMemberBackend(model);
    this.#persistent = true;
    old.dispose();
    logger.debug('SceneFactStore: upgraded to database storage');
  }

  // ── 群 ────────────────────────────────────────────────────────────────

  /** 已由平台确认过的群事实；从未确认过返回 undefined。 */
  async getGroup(platform: string, scope: SessionScope, sceneId: string) {
    return sceneGroupFactsOf(await this.sessions.get(platform, scope, sceneId));
  }

  putGroup(platform: string, scope: SessionScope, sceneId: string, facts: SceneGroupFactsInput): Promise<boolean> {
    return this.sessions.setSceneFacts(platform, scope, sceneId, facts);
  }

  patchGroup(platform: string, scope: SessionScope, sceneId: string, change: SceneGroupChange): Promise<boolean> {
    return this.sessions.patchSceneFacts(platform, scope, sceneId, change);
  }

  // ── 成员 ──────────────────────────────────────────────────────────────

  async getMember(platform: string, scope: SessionScope, sceneId: string, userId: string): Promise<SceneMemberRecord | undefined> {
    const record = await this.#backend.load({ platform, sceneKey: sceneKeyOf(scope, sceneId), userId });
    return record ?? undefined;
  }

  /** 平台刚确认的成员事实：整行替换（缺省字段 = 平台没有该值）。未变化时 `updated_at` 至多每 5 分钟刷新。 */
  putMember(platform: string, scope: SessionScope, sceneId: string, userId: string, facts: SceneMemberFacts): Promise<void> {
    const key = { platform, sceneKey: sceneKeyOf(scope, sceneId), userId: String(userId) };
    const clean = cleanFacts(facts);
    return this.#serial(async () => {
      const now = this.#now();
      const existing = await this.#backend.load(key);
      if (existing) {
        if (sameFacts(existing.facts, clean) && now - existing.updatedAt < SCENE_MEMBER_TOUCH_MS) return;
        await this.#backend.update({ ...key, facts: clean, updatedAt: now });
        return;
      }
      await this.#backend.insert({ ...key, facts: clean, updatedAt: now });
      await this.#afterInsert(key.platform, key.sceneKey);
    });
  }

  /** 侧事件写穿：只改已有的行；没有基线返回 false（下次读取会问平台）。 */
  patchMember(platform: string, scope: SessionScope, sceneId: string, userId: string, change: SceneMemberChange): Promise<boolean> {
    const key = { platform, sceneKey: sceneKeyOf(scope, sceneId), userId: String(userId) };
    return this.#serial(async () => {
      const existing = await this.#backend.load(key);
      if (!existing) return false;
      const facts = cleanFacts({
        ...existing.facts,
        ...(change.platformRole !== undefined ? { platformRole: change.platformRole } : {}),
        ...(change.card !== undefined ? { card: change.card } : {}),
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(change.mutedUntil !== undefined ? { mutedUntil: change.mutedUntil } : {}),
      });
      await this.#backend.update({ ...key, facts, updatedAt: this.#now() });
      return true;
    });
  }

  /** 成员离开 / 被踢：删行。 */
  deleteMember(platform: string, scope: SessionScope, sceneId: string, userId: string): Promise<void> {
    const key = { platform, sceneKey: sceneKeyOf(scope, sceneId), userId: String(userId) };
    return this.#serial(() => this.#backend.remove(key));
  }

  /** Bot 自己（每回合新鲜读取后）：成员行 + 会话画像里的 Bot 角色 / 禁言。 */
  async putBot(platform: string, scope: SessionScope, sceneId: string, botId: string, facts: SceneMemberFacts): Promise<void> {
    const role = facts.platformRole as BotSceneRole | undefined;
    await Promise.all([
      this.putMember(platform, scope, sceneId, botId, facts),
      this.sessions.setBotFacts(platform, scope, sceneId, {
        ...(role ? { role } : {}),
        ...(facts.mutedUntil !== undefined ? { muteUntil: facts.mutedUntil } : {}),
      }),
    ]);
  }

  // ── 清理 ──────────────────────────────────────────────────────────────

  /** 90 天未更新的行删除；每会话超过上限时淘汰最旧的。失败只记日志，返回已完成的部分。 */
  prune(): Promise<ScenePruneResult> {
    return this.#serial(async () => {
      let expired = 0;
      let evicted = 0;
      try {
        expired = await this.#backend.removeOlderThan(this.#now() - this.#retentionMs);
        const scenes = new Map<string, MemberStamp[]>();
        for (const stamp of await this.#backend.listAll()) {
          const key = `${stamp.platform}${SEP}${stamp.sceneKey}`;
          const list = scenes.get(key);
          if (list) list.push(stamp); else scenes.set(key, [stamp]);
        }
        for (const list of scenes.values()) evicted += await this.#evictOver(list);
      } catch (error) {
        logger.warn(formatCompact({ op: 'scene_member_prune_failed', error: error instanceof Error ? error.message : String(error) }));
      }
      return { expired, evicted };
    });
  }

  /** 启动之后每 6 小时清理一次；定时器不阻止进程退出。返回停止函数。 */
  startPruning(intervalMs: number = SCENE_FACT_PRUNE_INTERVAL_MS): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running || this.#disposed) return;
      running = true;
      void this.prune().finally(() => { running = false; });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  dispose(): void {
    this.#disposed = true;
    this.#backend.dispose();
    this.#inserts.clear();
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(run);
    this.#writes = next.catch(() => undefined);
    return next;
  }

  async #afterInsert(platform: string, sceneKey: string): Promise<void> {
    const key = `${platform}${SEP}${sceneKey}`;
    const count = (this.#inserts.get(key) ?? 0) + 1;
    if (count < CAP_CHECK_EVERY) { this.#inserts.set(key, count); return; }
    this.#inserts.delete(key);
    await this.#evictOver(await this.#backend.listScene(platform, sceneKey));
  }

  async #evictOver(list: MemberStamp[]): Promise<number> {
    if (list.length <= this.#maxPerScene) return 0;
    const doomed = [...list].sort((a, b) => a.updatedAt - b.updatedAt || a.userId.localeCompare(b.userId))
      .slice(0, list.length - this.#maxPerScene);
    for (const stamp of doomed) await this.#backend.remove(stamp);
    return doomed.length;
  }
}
