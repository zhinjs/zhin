/**
 * SessionProfileStore — 会话画像（#996）。
 *
 * 会话 = 一次对话所在的地方：私聊是只有一个人的会话，群/频道是多人会话。
 * 一行 = 一个会话，键为 `platform + scene_key`（`private:<userId>` / `group:<id>` / `channel:<id>`）。
 * 「这个人对 Bot 是谁」仍在 `ai_user_relations`（{@link UserRelationStore}）；
 * 两者一起构成会话画像：人物关系 + 会话上下文。
 *
 * 会话上下文记录：话题、管理员、成员概况、Bot 自己的发言限制。
 * - 管理员/成员/禁言由 `conversation_events`（member.joined/left/muted/unmuted/role_changed）
 *   与入站消息的发送者角色折叠而来，不依赖模型；
 * - 话题由模型经 `session_profile` 工具显式更新（条数、长度、敏感信息封顶）；
 * - {@link speakBlock} 判定 Bot 当前能否在此会话发言；不能发言时 IM 入站直接不进 AI 回合。
 */

import { getLogger } from '@zhin.js/logger';
import { sanitizeProfileText } from './user-relation.js';

const logger = getLogger('SessionProfile');

export const MAX_TOPICS = 5;
export const MAX_TOPIC_CHARS = 24;
export const MAX_ADMINS = 20;
export const MAX_RECENT_SPEAKERS = 30;
/** 成员概况里「最近活跃」的窗口。 */
export const RECENT_SPEAKER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 每次折叠最多读取的会话事件数。 */
export const EVENT_FOLD_LIMIT = 50;
/** 注入摘要的硬上限：一行、≤160 字符、最多 3 个话题 / 3 个管理员。 */
export const SUMMARY_MAX_CHARS = 160;
export const SUMMARY_TOPICS = 3;
export const SUMMARY_ADMINS = 3;
/** 同一人连续发言时，最近活跃时间最多每 5 分钟刷新一次（减少写库）。 */
export const SPEAKER_REFRESH_MS = 5 * 60 * 1000;

export const SESSION_SCOPES = ['private', 'group', 'channel'] as const;
export type SessionScope = typeof SESSION_SCOPES[number];
export type BotSceneRole = 'unknown' | 'member' | 'admin' | 'owner';

export const AI_SESSION_PROFILE_MODEL = {
  platform: { type: 'text' as const, nullable: false },
  scene_key: { type: 'text' as const, nullable: false },
  scope: { type: 'text' as const, nullable: false },
  title: { type: 'text' as const, default: '' },
  topics: { type: 'text' as const, default: '[]' },
  admins: { type: 'text' as const, default: '[]' },
  recent_speakers: { type: 'text' as const, default: '[]' },
  joined_count: { type: 'integer' as const, default: 0 },
  left_count: { type: 'integer' as const, default: 0 },
  bot_role: { type: 'text' as const, default: 'unknown' },
  mute_until: { type: 'bigint' as const, default: 0 },
  muted_all: { type: 'integer' as const, default: 0 },
  restriction: { type: 'text' as const, default: '' },
  restriction_until: { type: 'bigint' as const, default: 0 },
  event_cursor: { type: 'bigint' as const, default: 0 },
  /** ADR 0041 §6 场景事实（L2 缓存）：群主、人数、事实最近一次由平台确认的时间。 */
  owner_id: { type: 'text' as const, default: '' },
  member_count: { type: 'integer' as const, nullable: true },
  facts_updated_at: { type: 'bigint' as const, default: 0 },
  created_at: { type: 'bigint' as const, default: 0 },
  updated_at: { type: 'bigint' as const, default: 0 },
};

export interface SessionAdmin {
  id: string;
  name: string;
  role: 'owner' | 'admin';
}

export interface SessionSpeaker {
  id: string;
  at: number;
}

export interface SessionProfileRecord {
  platform: string;
  sceneKey: string;
  scope: SessionScope;
  title: string;
  topics: string[];
  admins: SessionAdmin[];
  recentSpeakers: SessionSpeaker[];
  joinedCount: number;
  leftCount: number;
  botRole: BotSceneRole;
  /** Bot 被禁言到何时（毫秒）；0 表示没有。 */
  muteUntil: number;
  /** 全员禁言 / 仅管理员可发言。 */
  mutedAll: boolean;
  /** 宿主或插件手动设置的限制原因（如 `rate_limited`、`readonly_channel`）；空表示无。 */
  restriction: string;
  /** 手动限制到何时；0 表示直到清除。 */
  restrictionUntil: number;
  eventCursor: number;
  /** ADR 0041 §6：群主账号；空表示未知。 */
  ownerId: string;
  /** ADR 0041 §6：群人数；null 表示未知。 */
  memberCount: number | null;
  /** 场景事实最近一次由平台确认的时间（毫秒）；0 表示从未取过。 */
  factsUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
}

export type SpeakBlockReason = 'muted' | 'muted_all' | `restricted:${string}`;

export function sceneKeyOf(scope: SessionScope, sceneId: string): string {
  return `${scope}:${sceneId}`;
}

export function emptySessionProfile(platform: string, scope: SessionScope, sceneId: string, now: number): SessionProfileRecord {
  return {
    platform, sceneKey: sceneKeyOf(scope, sceneId), scope, title: '',
    topics: [], admins: [], recentSpeakers: [], joinedCount: 0, leftCount: 0,
    botRole: 'unknown', muteUntil: 0, mutedAll: false, restriction: '', restrictionUntil: 0,
    eventCursor: 0, ownerId: '', memberCount: null, factsUpdatedAt: 0, createdAt: now, updatedAt: now,
  };
}

/** Bot 当前在此会话能否发言；能发言返回 null。 */
export function speakBlock(record: SessionProfileRecord | null, now: number): SpeakBlockReason | null {
  if (!record) return null;
  if (record.restriction && (record.restrictionUntil === 0 || record.restrictionUntil > now)) {
    return `restricted:${record.restriction}`;
  }
  if (record.muteUntil > now) return 'muted';
  if (record.mutedAll && record.botRole !== 'admin' && record.botRole !== 'owner') return 'muted_all';
  return null;
}

// ============================================================================
// 事件折叠（纯函数）
// ============================================================================

/** `conversation_events` 中本模块关心的子集（结构化类型，避免依赖具体 store）。 */
export type FoldableConversationEvent =
  | { type: 'member.joined'; member: { id: string; displayName?: string } }
  | { type: 'member.left'; member: { id: string; displayName?: string } }
  | { type: 'member.muted'; member: { id: string; displayName?: string }; durationSeconds: number; timestamp: number }
  | { type: 'member.unmuted'; member: { id: string; displayName?: string } }
  | { type: 'member.role_changed'; member: { id: string; displayName?: string }; role: string; enabled: boolean }
  | { type: string; timestamp?: number; member?: { id: string; displayName?: string } };

/** OneBot 等平台以 user_id 0 表示「全员」。 */
const WHOLE_SCENE_IDS = new Set(['0', 'all']);

function upsertAdmin(admins: SessionAdmin[], admin: SessionAdmin): SessionAdmin[] {
  const rest = admins.filter((item) => item.id !== admin.id);
  const merged = [...rest, admin];
  // 群主优先保留
  merged.sort((left, right) => (left.role === right.role ? 0 : left.role === 'owner' ? -1 : 1));
  return merged.slice(0, MAX_ADMINS);
}

/**
 * 把一条会话事件折叠进会话画像。`selfIds` 为 Bot 在该平台的账号（可能多个候选）。
 * 返回新记录（不修改入参）。
 */
export function foldConversationEvent(
  record: SessionProfileRecord,
  event: FoldableConversationEvent,
  selfIds: ReadonlySet<string>,
  now: number,
): SessionProfileRecord {
  const next: SessionProfileRecord = { ...record };
  const member = 'member' in event ? event.member : undefined;
  if (!member) return next;
  const memberId = String(member.id);
  const isSelf = selfIds.has(memberId);
  switch (event.type) {
    case 'member.joined':
      if (!isSelf) next.joinedCount += 1;
      return next;
    case 'member.left':
      if (!isSelf) {
        next.leftCount += 1;
        next.admins = next.admins.filter((item) => item.id !== memberId);
      }
      return next;
    case 'member.muted': {
      const durationSeconds = Number((event as { durationSeconds?: number }).durationSeconds) || 0;
      const at = Number((event as { timestamp?: number }).timestamp) || now;
      if (WHOLE_SCENE_IDS.has(memberId)) {
        next.mutedAll = true;
      } else if (isSelf) {
        // duration 0 在部分平台表示「解除」；这里按「到期即解除」处理，缺省 30 天上限。
        next.muteUntil = durationSeconds > 0 ? at + durationSeconds * 1000 : at + 30 * 24 * 3600 * 1000;
      }
      return next;
    }
    case 'member.unmuted':
      if (WHOLE_SCENE_IDS.has(memberId)) next.mutedAll = false;
      else if (isSelf) next.muteUntil = 0;
      return next;
    case 'member.role_changed': {
      const role = (event as { role?: string }).role;
      const enabled = (event as { enabled?: boolean }).enabled === true;
      if (role !== 'admin' && role !== 'owner') return next;
      if (isSelf) {
        next.botRole = enabled ? role : 'member';
      } else if (enabled) {
        next.admins = upsertAdmin(next.admins, { id: memberId, name: sanitizeProfileText(member.displayName, 24) ?? '', role });
      } else {
        next.admins = next.admins.filter((item) => item.id !== memberId);
      }
      return next;
    }
    default:
      return next;
  }
}

/** 从发送者平台角色里读出群主/管理员。 */
export function sceneRoleOf(roles: readonly unknown[] | undefined): 'owner' | 'admin' | undefined {
  const set = new Set((roles ?? []).map((role) => String(role)));
  if (set.has('owner') || set.has('scene_owner')) return 'owner';
  if (set.has('admin') || set.has('scene_admin')) return 'admin';
  return undefined;
}

export interface InboundSender {
  id: string;
  name?: string;
  sceneRole?: 'owner' | 'admin';
}

/** 把一条入站消息的发送者折叠进成员/管理员概况。 */
export function foldInboundSender(record: SessionProfileRecord, sender: InboundSender, now: number): SessionProfileRecord {
  const next: SessionProfileRecord = { ...record };
  const seen = record.recentSpeakers.find((item) => item.id === sender.id);
  if (!seen || now - seen.at >= SPEAKER_REFRESH_MS) {
    const speakers = record.recentSpeakers.filter((item) => item.id !== sender.id && now - item.at < RECENT_SPEAKER_WINDOW_MS);
    speakers.push({ id: sender.id, at: now });
    next.recentSpeakers = speakers.slice(-MAX_RECENT_SPEAKERS);
  }
  if (sender.sceneRole) {
    next.admins = upsertAdmin(record.admins, { id: sender.id, name: sanitizeProfileText(sender.name, 24) ?? '', role: sender.sceneRole });
  }
  return next;
}

// ============================================================================
// ADR 0041 §6 场景事实（群级）
// ============================================================================

/** 存库的名称 / 昵称类文本上限。 */
export const SCENE_FACT_TEXT_MAX_CHARS = 128;
/** 群管理员 id 的写入上限（与适配器读取上限一致）。 */
export const MAX_SCENE_ADMIN_IDS = 20;

/** 去控制字符、折叠空白并截断；空串表示没有。 */
export function cleanSceneFactText(value: unknown, maxChars: number = SCENE_FACT_TEXT_MAX_CHARS): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxChars);
}

/** 平台一次读取的群事实（字段缺省 = 未知）。 */
export interface SceneGroupFactsInput {
  readonly name?: string;
  readonly ownerId?: string;
  readonly adminIds?: readonly string[];
  readonly memberCount?: number;
  readonly muteAll?: boolean;
}

/** 侧事件带来的群级增量。 */
export interface SceneGroupChange {
  /** 人数增减。 */
  readonly memberDelta?: number;
  readonly admin?: Readonly<{ id: string; enabled: boolean }>;
  readonly ownerId?: string;
  readonly muteAll?: boolean;
  readonly botRole?: BotSceneRole;
  readonly botMuteUntil?: number;
}

function validId(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? cleanSceneFactText(String(value), 64) : '';
}

function applySceneGroupFacts(record: SessionProfileRecord, facts: SceneGroupFactsInput, now: number): SessionProfileRecord | null {
  const next: SessionProfileRecord = { ...record };
  let known = false;
  const name = cleanSceneFactText(facts.name);
  if (name) { next.title = name; known = true; }
  const ownerId = validId(facts.ownerId);
  if (ownerId) {
    next.ownerId = ownerId;
    next.admins = record.admins.filter((item) => !(item.role === 'owner' && item.id !== ownerId));
    known = true;
  }
  if (facts.adminIds) {
    const owners = next.admins.filter((item) => item.role === 'owner');
    const names = new Map(record.admins.map((item) => [item.id, item.name]));
    const ids = [...new Set(facts.adminIds.map(validId).filter((id) => id && id !== next.ownerId))].slice(0, MAX_SCENE_ADMIN_IDS);
    next.admins = [...owners, ...ids.map((id) => ({ id, name: names.get(id) ?? '', role: 'admin' as const }))];
    known = true;
  }
  if (typeof facts.memberCount === 'number' && Number.isSafeInteger(facts.memberCount) && facts.memberCount >= 0) {
    next.memberCount = facts.memberCount;
    known = true;
  }
  if (typeof facts.muteAll === 'boolean') { next.mutedAll = facts.muteAll; known = true; }
  if (!known) return null;
  next.factsUpdatedAt = now;
  return next;
}

function applySceneGroupChange(record: SessionProfileRecord, change: SceneGroupChange): SessionProfileRecord {
  const next: SessionProfileRecord = { ...record };
  if (change.memberDelta && next.memberCount !== null) next.memberCount = Math.max(0, next.memberCount + change.memberDelta);
  if (change.admin) {
    const id = validId(change.admin.id);
    if (id) {
      next.admins = change.admin.enabled && id !== next.ownerId
        ? upsertAdmin(next.admins, { id, name: next.admins.find((item) => item.id === id)?.name ?? '', role: 'admin' })
        : next.admins.filter((item) => item.id !== id);
    }
  }
  if (change.ownerId) {
    const ownerId = validId(change.ownerId);
    if (ownerId) {
      next.ownerId = ownerId;
      next.admins = next.admins.filter((item) => item.id !== ownerId && item.role !== 'owner');
    }
  }
  if (change.muteAll !== undefined) next.mutedAll = change.muteAll;
  if (change.botRole && change.botRole !== 'unknown') next.botRole = change.botRole;
  if (change.botMuteUntil !== undefined && Number.isFinite(change.botMuteUntil)) next.muteUntil = Math.max(0, Math.floor(change.botMuteUntil));
  return next;
}

/** 会话画像里已确认的群事实；从未由平台确认过则返回 undefined。 */
export function sceneGroupFactsOf(record: SessionProfileRecord | null): Readonly<{ facts: SceneGroupFactsInput; updatedAt: number }> | undefined {
  if (!record || record.factsUpdatedAt <= 0) return undefined;
  const adminIds = record.admins.filter((item) => item.role === 'admin').map((item) => item.id);
  return {
    updatedAt: record.factsUpdatedAt,
    facts: {
      ...(record.title ? { name: record.title } : {}),
      ...(record.ownerId ? { ownerId: record.ownerId } : {}),
      ...(adminIds.length ? { adminIds } : {}),
      ...(record.memberCount !== null ? { memberCount: record.memberCount } : {}),
      muteAll: record.mutedAll,
    },
  };
}

// ============================================================================
// 持久化
// ============================================================================

interface DbModel {
  select(...fields: string[]): any;
  create(data: Record<string, any>): Promise<any>;
  update(data: Partial<any>): any;
}

interface SessionBackend {
  load(platform: string, sceneKey: string): Promise<SessionProfileRecord | null>;
  save(record: SessionProfileRecord, isNew: boolean): Promise<void>;
  dispose(): void;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function isScope(value: unknown): value is SessionScope {
  return typeof value === 'string' && (SESSION_SCOPES as readonly string[]).includes(value);
}

function isBotRole(value: unknown): value is BotSceneRole {
  return value === 'unknown' || value === 'member' || value === 'admin' || value === 'owner';
}

export function sessionProfileFromRow(row: Record<string, any>): SessionProfileRecord {
  return {
    platform: String(row.platform),
    sceneKey: String(row.scene_key),
    scope: isScope(row.scope) ? row.scope : 'group',
    title: String(row.title ?? ''),
    topics: parseJson<unknown[]>(row.topics, []).filter((item): item is string => typeof item === 'string'),
    admins: parseJson<SessionAdmin[]>(row.admins, []).filter((item) => item && typeof item.id === 'string'),
    recentSpeakers: parseJson<SessionSpeaker[]>(row.recent_speakers, []).filter((item) => item && typeof item.id === 'string'),
    joinedCount: Number(row.joined_count ?? 0) || 0,
    leftCount: Number(row.left_count ?? 0) || 0,
    botRole: isBotRole(row.bot_role) ? row.bot_role : 'unknown',
    muteUntil: Number(row.mute_until ?? 0) || 0,
    mutedAll: Number(row.muted_all ?? 0) === 1,
    restriction: String(row.restriction ?? ''),
    restrictionUntil: Number(row.restriction_until ?? 0) || 0,
    eventCursor: Number(row.event_cursor ?? 0) || 0,
    ownerId: String(row.owner_id ?? ''),
    memberCount: row.member_count === null || row.member_count === undefined ? null : Number(row.member_count),
    factsUpdatedAt: Number(row.facts_updated_at ?? 0) || 0,
    createdAt: Number(row.created_at ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? 0) || 0,
  };
}

export function sessionProfileToRow(record: SessionProfileRecord): Record<string, unknown> {
  return {
    platform: record.platform,
    scene_key: record.sceneKey,
    scope: record.scope,
    title: record.title,
    topics: JSON.stringify(record.topics),
    admins: JSON.stringify(record.admins),
    recent_speakers: JSON.stringify(record.recentSpeakers),
    joined_count: record.joinedCount,
    left_count: record.leftCount,
    bot_role: record.botRole,
    mute_until: record.muteUntil,
    muted_all: record.mutedAll ? 1 : 0,
    restriction: record.restriction,
    restriction_until: record.restrictionUntil,
    event_cursor: record.eventCursor,
    owner_id: record.ownerId,
    member_count: record.memberCount,
    facts_updated_at: record.factsUpdatedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function clone(record: SessionProfileRecord): SessionProfileRecord {
  return {
    ...record,
    topics: [...record.topics],
    admins: record.admins.map((item) => ({ ...item })),
    recentSpeakers: record.recentSpeakers.map((item) => ({ ...item })),
  };
}

class MemorySessionBackend implements SessionBackend {
  private readonly data = new Map<string, SessionProfileRecord>();
  async load(platform: string, sceneKey: string) {
    const found = this.data.get(`${platform}\u0000${sceneKey}`);
    return found ? clone(found) : null;
  }
  async save(record: SessionProfileRecord) {
    this.data.set(`${record.platform}\u0000${record.sceneKey}`, clone(record));
  }
  dispose() { this.data.clear(); }
}

class DatabaseSessionBackend implements SessionBackend {
  constructor(private readonly model: DbModel) {}
  async load(platform: string, sceneKey: string) {
    const rows = await this.model.select().where({ platform, scene_key: sceneKey }) as Record<string, any>[];
    return rows.length > 0 ? sessionProfileFromRow(rows[0]) : null;
  }
  async save(record: SessionProfileRecord, isNew: boolean) {
    const row = sessionProfileToRow(record);
    if (isNew) {
      await this.model.create(row);
      return;
    }
    const { platform, scene_key, ...rest } = row;
    await this.model.update(rest).where({ platform, scene_key });
  }
  dispose() {}
}

// ============================================================================
// Store
// ============================================================================

export interface SessionEventSource {
  listBetween(afterExclusive: number, throughInclusive: number, limit: number): Promise<readonly { sequence: number; event: FoldableConversationEvent }[]>;
}

export interface ObserveInboundInput {
  platform: string;
  scope: SessionScope;
  sceneId: string;
  title?: string;
  sender?: InboundSender;
  /** Bot 在该平台的账号候选（如 endpoint id / selfId）。 */
  selfIds?: readonly string[];
  /** 本条入站消息在 conversation_events 中的序号；有则先折叠此前未处理的事件。 */
  throughSequence?: number;
  events?: SessionEventSource;
}

export class SessionProfileStore {
  private backend: SessionBackend = new MemorySessionBackend();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** 已折叠到的事件序号（内存）；只有画像真的变了才连同写库。 */
  private readonly cursors = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  upgradeToDatabase(model: DbModel): void {
    const old = this.backend;
    this.backend = new DatabaseSessionBackend(model);
    old.dispose();
    logger.debug('SessionProfileStore: upgraded to database storage');
  }

  async get(platform: string, scope: SessionScope, sceneId: string): Promise<SessionProfileRecord | null> {
    return this.backend.load(platform, sceneKeyOf(scope, sceneId));
  }

  private mutate(
    platform: string,
    scope: SessionScope,
    sceneId: string,
    change: (record: SessionProfileRecord, now: number, isNew: boolean) => Promise<SessionProfileRecord | null> | SessionProfileRecord | null,
  ): Promise<SessionProfileRecord | null> {
    const sceneKey = sceneKeyOf(scope, sceneId);
    const key = `${platform}\u0000${sceneKey}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const now = this.now();
      const existing = await this.backend.load(platform, sceneKey);
      const base = existing ?? emptySessionProfile(platform, scope, sceneId, now);
      const next = await change(base, now, !existing);
      if (!next) return existing;
      next.updatedAt = now;
      await this.backend.save(next, !existing);
      return next;
    });
    this.queues.set(key, run);
    void run.finally(() => {
      if (this.queues.get(key) === run) this.queues.delete(key);
    }).catch(() => undefined);
    return run;
  }

  /**
   * 每条 IM 入站消息调用一次（在旁听判定与 AI 回合之前）：
   * 折叠新的会话事件与发送者信息，返回 Bot 当前能否发言。
   */
  async observeInbound(input: ObserveInboundInput): Promise<{ profile: SessionProfileRecord | null; blocked: SpeakBlockReason | null }> {
    const cursorKey = `${input.platform}\u0000${sceneKeyOf(input.scope, input.sceneId)}`;
    const profile = await this.mutate(input.platform, input.scope, input.sceneId, async (record, now, isNew) => {
      let next = record;
      const cursor = Math.max(record.eventCursor, this.cursors.get(cursorKey) ?? 0);
      if (input.events && input.throughSequence !== undefined && input.throughSequence > cursor) {
        const after = cursor > 0 ? cursor : Math.max(0, input.throughSequence - EVENT_FOLD_LIMIT);
        const selfIds = new Set((input.selfIds ?? []).filter(Boolean).map(String));
        const events = await input.events.listBetween(after, input.throughSequence, EVENT_FOLD_LIMIT);
        for (const { event } of events) next = foldConversationEvent(next, event, selfIds, now);
        this.cursors.set(cursorKey, input.throughSequence);
      }
      if (input.sender && input.scope !== 'private') next = foldInboundSender(next, input.sender, now);
      const title = sanitizeProfileText(input.title, 40);
      if (title) next = { ...next, title };
      if (!isNew && sameProfile(record, next)) return null;
      return { ...next, eventCursor: Math.max(next.eventCursor, this.cursors.get(cursorKey) ?? 0) };
    });
    return { profile, blocked: speakBlock(profile, this.now()) };
  }

  /** 模型或宿主更新话题（覆盖式，最多 5 条，每条 ≤24 字，过滤敏感信息）。 */
  async setTopics(platform: string, scope: SessionScope, sceneId: string, topics: readonly string[]): Promise<string[]> {
    const clean: string[] = [];
    for (const topic of topics) {
      const value = sanitizeProfileText(topic, MAX_TOPIC_CHARS);
      if (value && !clean.some((item) => item.toLowerCase() === value.toLowerCase())) clean.push(value);
    }
    const kept = clean.slice(0, MAX_TOPICS);
    await this.mutate(platform, scope, sceneId, (record) => ({ ...record, topics: kept }));
    return kept;
  }

  /**
   * 宿主/插件设置 Bot 在此会话的发言限制（如只读频道、平台限频）。
   * `reason` 为空字符串表示清除；`untilMs` 为 0 表示直到清除。
   */
  async setRestriction(platform: string, scope: SessionScope, sceneId: string, reason: string, untilMs = 0): Promise<void> {
    const clean = reason.trim() === '' ? '' : sanitizeProfileText(reason, 40) ?? 'restricted';
    await this.mutate(platform, scope, sceneId, (record) => ({ ...record, restriction: clean, restrictionUntil: clean ? untilMs : 0 }));
  }

  /** 宿主已知 Bot 的群角色时可直接写入（事件里拿不到时）。 */
  async setBotRole(platform: string, scope: SessionScope, sceneId: string, role: BotSceneRole): Promise<void> {
    if (!isBotRole(role)) throw new TypeError(`Unknown bot role: ${String(role)}`);
    await this.mutate(platform, scope, sceneId, (record) => ({ ...record, botRole: role }));
  }

  /**
   * ADR 0041 §6 L2：平台刚确认的群事实（名称、群主、管理员、人数、全员禁言）。缺省字段保持原值
   * （例如名册读取失败时管理员不被清空）；至少写入一个字段才会刷新 `factsUpdatedAt`。
   * 返回是否写入。
   */
  async setSceneFacts(platform: string, scope: SessionScope, sceneId: string, facts: SceneGroupFactsInput): Promise<boolean> {
    if (scope === 'private') return false;
    let wrote = false;
    await this.mutate(platform, scope, sceneId, (record, now) => {
      const next = applySceneGroupFacts(record, facts, now);
      if (!next) return null;
      wrote = true;
      return next;
    });
    return wrote;
  }

  /**
   * ADR 0041 §6 L2 写穿：侧事件带来的增量变化。只改已有平台事实的会话（没有基线就不凭增量造事实）；
   * 不刷新 `factsUpdatedAt`，陈旧判定仍以平台上次确认为准。
   */
  async patchSceneFacts(platform: string, scope: SessionScope, sceneId: string, change: SceneGroupChange): Promise<boolean> {
    if (scope === 'private') return false;
    let wrote = false;
    await this.mutate(platform, scope, sceneId, (record) => {
      if (record.factsUpdatedAt <= 0) return null;
      const next = applySceneGroupChange(record, change);
      if (sameProfile(record, next)) return null;
      wrote = true;
      return next;
    });
    return wrote;
  }

  /** Bot 自己的角色 / 禁言到期（每回合新鲜读取后写穿）；与基线无关，未变化不写库。 */
  async setBotFacts(platform: string, scope: SessionScope, sceneId: string, facts: Readonly<{ role?: BotSceneRole; muteUntil?: number }>): Promise<void> {
    if (scope === 'private') return;
    await this.mutate(platform, scope, sceneId, (record) => {
      const next: SessionProfileRecord = { ...record };
      if (facts.role && facts.role !== 'unknown') next.botRole = facts.role;
      if (facts.muteUntil !== undefined && Number.isFinite(facts.muteUntil)) next.muteUntil = Math.max(0, Math.floor(facts.muteUntil));
      return sameProfile(record, next) ? null : next;
    });
  }

  /**
   * 构建注入回合上下文的 `[Session]` 段：**只有一行**，最多 3 个话题、3 个管理员，整行 ≤ SUMMARY_MAX_CHARS。
   * 私聊或没有可说的内容时返回空串。
   */
  buildSummary(record: SessionProfileRecord | null): string {
    if (!record || record.scope === 'private') return '';
    const now = this.now();
    const parts: string[] = [];
    if (record.title) parts.push(`"${clip(record.title, 20)}"`);
    if (record.topics.length) parts.push(`topics: ${record.topics.slice(0, SUMMARY_TOPICS).join('; ')}`);
    const admins = record.admins.filter((item) => item.name).slice(0, SUMMARY_ADMINS);
    if (admins.length) parts.push(`admins: ${admins.map((item) => `${clip(item.name, 12)}${item.role === 'owner' ? '(owner)' : ''}`).join(', ')}`);
    const active = record.recentSpeakers.filter((item) => now - item.at < RECENT_SPEAKER_WINDOW_MS).length;
    if (active > 1) parts.push(`~${active} active today`);
    if (record.botRole === 'admin' || record.botRole === 'owner') parts.push(`you: ${record.botRole}`);
    if (parts.length === 0) return '';
    return clip(`[Session] ${record.scope} (data, don't quote): ${parts.join(' · ')}`, SUMMARY_MAX_CHARS);
  }

  dispose(): void {
    this.backend.dispose();
    this.queues.clear();
    this.cursors.clear();
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sameProfile(left: SessionProfileRecord, right: SessionProfileRecord): boolean {
  const strip = (record: SessionProfileRecord) => JSON.stringify({ ...sessionProfileToRow(record), event_cursor: 0, updated_at: 0 });
  return strip(left) === strip(right);
}
