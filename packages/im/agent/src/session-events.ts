/**
 * 会话日程（ADR 0037 §2，第 1 期切片 D）：会话级事件 `ai_session_events` 与到点提醒的存储。
 *
 * - 每个事件一行，`revision` 乐观并发（与公告 / 控制面 `expectedRevision` 同约定）。
 * - 状态：`scheduled` → `done`（全部偏移已触发）/ `cancelled`（只经 Console）；`done` / `cancelled` 为终态。
 * - 提醒偏移：`at` 本身（偏移 0）**始终提醒**，`remind_before` 只追加提前量（验收标准 2「提前与到点各提醒一次」）；
 *   空数组 = 只在 `at` 提醒。已触发（或已判定跳过）的偏移记进 `fired`，防重复、不补发。
 * - 创建 / 修改时已过去的偏移直接记入 `fired`（不发、不算 missed），审计 `payload.skippedOffsets` 可查。
 * - 创建 / 修改 / 取消各写一行 `kind=schedule` 审计（`schedule_event_created` / `_updated` / `_cancelled`）；
 *   到点触发结果由宿主的发送路径写（`schedule_wake_*` 或沿用的 `control_*` / `cannot_speak_*`）。审计写失败不影响迁移。
 * - 持久化：接上表后以表为准（先落库再生效）；未接表时只存进程内（测试 / 无数据库）。
 * - 领域独立：不写 `schedule-jobs.json`，不进 `schedule-manager`；计时见 {@link createSessionEventTimer}。
 */
import { randomUUID } from 'node:crypto';
import { ScheduleEngine } from '@zhin.js/kernel';
import type { DecisionActor, DecisionEventInput, DecisionOutcome, DecisionReasonCode } from './decision-events.js';

export const AI_SESSION_EVENTS_TABLE = 'ai_session_events';
/** 错过提醒的宽限（`schedule.graceMs`）：默认 10 分钟（ADR 0037「待 Fin 确认的默认值」）。 */
export const DEFAULT_SESSION_EVENT_GRACE_MS = 10 * 60 * 1000;
export const MAX_SESSION_EVENT_TITLE_CHARS = 60;
export const MAX_SESSION_EVENT_TEMPLATE_CHARS = 500;
export const MAX_SESSION_EVENT_REMIND_OFFSETS = 5;
/** 单个提前量上限：30 天。 */
export const MAX_SESSION_EVENT_REMIND_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
/** `at` 最远：一年后。 */
export const MAX_SESSION_EVENT_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
/** 未接数据库时进程内最多保留多少条（超出时淘汰最旧的终态行）。 */
export const MAX_IN_MEMORY_SESSION_EVENTS = 2_000;
/** 一次列表最多返回多少条。 */
export const MAX_SESSION_EVENT_LIST = 200;
/** 实例默认提醒模板（模板直发、不调模型）。 */
export const DEFAULT_SESSION_EVENT_TEMPLATE = '【日程提醒】{title}：{at}（{in}）';
/** `{at}` 的展示时区缺省值（与 job-scheduler / schedule host 同口径）。 */
export const DEFAULT_SESSION_EVENT_TIMEZONE = 'Asia/Shanghai';

export const SESSION_EVENT_STATUSES = ['scheduled', 'done', 'cancelled'] as const;
export type SessionEventStatus = typeof SESSION_EVENT_STATUSES[number];
export const SESSION_EVENT_CREATED_VIA = ['console', 'model'] as const;
export type SessionEventCreatedVia = typeof SESSION_EVENT_CREATED_VIA[number];
export const SESSION_EVENT_TEMPLATE_VARS = ['title', 'at', 'in'] as const;
export type SessionEventTemplateVar = typeof SESSION_EVENT_TEMPLATE_VARS[number];

export const AI_SESSION_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  /** 创建时的 Bot 账号（模型创建时取当前回合的 endpoint）；为空时发送端按平台唯一在线账号解析。 */
  endpoint: { type: 'text' as const, nullable: true },
  title: { type: 'text' as const, nullable: false },
  /** 事件时间（ms，UTC）。 */
  at: { type: 'bigint' as const, nullable: false },
  /** 提前提醒偏移（ms），JSON 数组文本。 */
  remind_before: { type: 'text' as const, nullable: false, default: '[]' },
  template: { type: 'text' as const, nullable: true },
  status: { type: 'text' as const, nullable: false, default: 'scheduled' },
  /** 已触发（或已判定跳过）的偏移（ms），JSON 数组文本；偏移 0 = `at` 本身。 */
  fired: { type: 'text' as const, nullable: false, default: '[]' },
  created_by: { type: 'text' as const, nullable: false },
  created_via: { type: 'text' as const, nullable: false },
  revision: { type: 'bigint' as const, nullable: false, default: 0 },
  created_at: { type: 'bigint' as const, nullable: false },
  updated_at: { type: 'bigint' as const, nullable: false },
  updated_by: { type: 'text' as const, nullable: true },
};

export interface SessionEventRecord {
  readonly id: string;
  readonly platform: string;
  /** `<scope>:<sceneId>`，与会话画像 `sceneKey` 同口径，只接受 `group` / `channel`。 */
  readonly sceneId: string;
  readonly endpoint: string | null;
  readonly title: string;
  readonly at: number;
  readonly remindBefore: readonly number[];
  /** 空字符串 / null = 用实例默认模板。 */
  readonly template: string | null;
  readonly status: SessionEventStatus;
  readonly fired: readonly number[];
  readonly createdBy: string;
  readonly createdVia: SessionEventCreatedVia;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
}

export class SessionEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEventValidationError';
  }
}

export class SessionEventNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`session event ${id} not found`);
    this.id = id;
    this.name = 'SessionEventNotFoundError';
  }
}

export class SessionEventRevisionConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super(`session event revision conflict: current revision is ${currentRevision}`);
    this.currentRevision = currentRevision;
    this.name = 'SessionEventRevisionConflictError';
  }
}

export class SessionEventStateError extends Error {
  readonly status: SessionEventStatus;
  readonly action: string;
  constructor(status: SessionEventStatus, action: string) {
    super(`session event in status ${status} cannot ${action}`);
    this.status = status;
    this.action = action;
    this.name = 'SessionEventStateError';
  }
}

export class SessionEventUnavailableError extends Error {
  constructor(message = 'session event storage is unavailable') {
    super(message);
    this.name = 'SessionEventUnavailableError';
  }
}

const SCENE_ID_PATTERN = /^(group|channel):.+/u;

function isStatus(value: unknown): value is SessionEventStatus {
  return typeof value === 'string' && (SESSION_EVENT_STATUSES as readonly string[]).includes(value);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function offsetsOf(value: unknown): number[] {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => b - a);
}

export function sessionEventFromRow(row: Record<string, unknown>): SessionEventRecord {
  return Object.freeze({
    id: String(row.id),
    platform: String(row.platform ?? ''),
    sceneId: String(row.scene_id ?? ''),
    endpoint: str(row.endpoint) || null,
    title: String(row.title ?? ''),
    at: num(row.at) ?? 0,
    remindBefore: Object.freeze(offsetsOf(row.remind_before).filter((n) => n > 0)),
    template: str(row.template) || null,
    // 未知状态按已取消处理：不会被调度发送。
    status: isStatus(row.status) ? row.status : 'cancelled',
    fired: Object.freeze(offsetsOf(row.fired)),
    createdBy: String(row.created_by ?? ''),
    createdVia: row.created_via === 'model' ? 'model' : 'console',
    revision: num(row.revision) ?? 0,
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
    updatedBy: str(row.updated_by),
  });
}

export function sessionEventToRow(record: SessionEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    platform: record.platform,
    scene_id: record.sceneId,
    endpoint: record.endpoint,
    title: record.title,
    at: record.at,
    remind_before: JSON.stringify([...record.remindBefore]),
    template: record.template,
    status: record.status,
    fired: JSON.stringify([...record.fired]),
    created_by: record.createdBy,
    created_via: record.createdVia,
    revision: record.revision,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    updated_by: record.updatedBy,
  };
}

/** 该事件要提醒的全部偏移（ms，降序）：`remind_before` ∪ {0}。 */
export function sessionEventOffsets(record: Pick<SessionEventRecord, 'remindBefore'>): readonly number[] {
  return [...new Set([...record.remindBefore, 0])].sort((a, b) => b - a);
}

/** 一个待触发的提醒：事件 + 偏移 + 计划触发时刻。 */
export interface SessionEventReminder {
  readonly event: SessionEventRecord;
  readonly offset: number;
  readonly fireAt: number;
}

/** 尚未触发的提醒（按触发时刻升序）。只看 `scheduled`。 */
export function pendingSessionEventReminders(record: SessionEventRecord): readonly SessionEventReminder[] {
  if (record.status !== 'scheduled') return [];
  const fired = new Set(record.fired);
  return sessionEventOffsets(record)
    .filter((offset) => !fired.has(offset))
    .map((offset) => Object.freeze({ event: record, offset, fireAt: record.at - offset }))
    .sort((a, b) => a.fireAt - b.fireAt || b.offset - a.offset);
}

// ── 模板 ──────────────────────────────────────────────────────────────────

export interface SessionEventRender {
  readonly text: string;
  /** 模板里出现、但不在白名单里的变量名（原样保留）。 */
  readonly unknownVars: readonly string[];
}

/** `{in}`：距事件开始还有多久（先取整到分钟，再按最大整单位展示）。 */
export function formatSessionEventIn(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '现在';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天后`;
  if (minutes > 1440) return `${Math.round(minutes / 60)} 小时后`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时后`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后`;
  return `${minutes} 分钟后`;
}

/** `{at}`：实例时区的 `YYYY-MM-DD HH:mm`。时区无效时回落默认时区。 */
export function formatSessionEventAt(at: number, timezone = DEFAULT_SESSION_EVENT_TIMEZONE): string {
  const format = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  };
  try {
    return format(timezone);
  } catch {
    return format(DEFAULT_SESSION_EVENT_TIMEZONE);
  }
}

/** 渲染提醒模板：只替换 `{title}` `{at}` `{in}`；未知变量原样保留并返回名单，不报错。 */
export function renderSessionEventTemplate(
  template: string | null | undefined,
  input: Readonly<{ title: string; at: number; offset: number; timezone?: string }>,
): SessionEventRender {
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_SESSION_EVENT_TEMPLATE;
  const unknown = new Set<string>();
  const text = source.replace(/\{([a-z_][a-z0-9_]*)\}/giu, (whole, name: string) => {
    switch (name) {
      case 'title': return input.title;
      case 'at': return formatSessionEventAt(input.at, input.timezone);
      case 'in': return formatSessionEventIn(input.offset);
      default:
        unknown.add(name);
        return whole;
    }
  });
  return Object.freeze({ text, unknownVars: Object.freeze([...unknown]) });
}

// ── 存储 ──────────────────────────────────────────────────────────────────

/** 表模型的最小形状（与其他 `ai_*` 表同约定）。 */
export interface SessionEventModel {
  select(): { where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]> };
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

/** 审计写入口（`DecisionEventLog.record` 结构兼容）；写失败不得影响迁移。 */
export interface SessionEventAuditSink {
  record(input: DecisionEventInput): unknown;
}

export interface SessionEventTransition {
  readonly record: SessionEventRecord;
  readonly from: SessionEventStatus | null;
  readonly to: SessionEventStatus;
  readonly reasonCode: DecisionReasonCode;
  readonly turnId: string;
}

export interface SessionEventsOptions {
  readonly now?: () => number;
  readonly audit?: () => SessionEventAuditSink | undefined;
  readonly instanceId?: string;
}

export interface CreateSessionEventInput {
  readonly platform: string;
  readonly sceneId: string;
  readonly title: string;
  readonly at: number;
  readonly remindBefore?: readonly number[];
  readonly template?: string | null;
  readonly createdBy: string;
  readonly createdVia: SessionEventCreatedVia;
  readonly endpoint?: string | null;
  readonly turnId?: string;
}

export interface SessionEventMutationInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly actorId: string;
  readonly turnId?: string;
}

export interface UpdateSessionEventInput extends SessionEventMutationInput {
  readonly title?: string;
  readonly at?: number;
  readonly remindBefore?: readonly number[];
  readonly template?: string | null;
}

/** 发送路径落账：这些偏移已触发（发出 / 被拦 / 错过 / 失败一律算），不再补发。 */
export interface MarkSessionEventFiredInput {
  readonly id: string;
  readonly offsets: readonly number[];
}

export interface MarkSessionEventFiredResult {
  /** 落账后的事件（找不到时为 null）。 */
  readonly record: SessionEventRecord | null;
  /** 本次新记入 `fired` 的偏移；已被别处记过的不在其中（发送路径据此保证至多一次）。 */
  readonly claimed: readonly number[];
}

function checkTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new SessionEventValidationError('title must not be empty');
  const title = value.trim();
  if (Array.from(title).length > MAX_SESSION_EVENT_TITLE_CHARS) {
    throw new SessionEventValidationError(`title must be at most ${MAX_SESSION_EVENT_TITLE_CHARS} characters`);
  }
  return title;
}

function checkTemplate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new SessionEventValidationError('template must be text');
  if (!value.trim()) return null;
  if (Array.from(value).length > MAX_SESSION_EVENT_TEMPLATE_CHARS) {
    throw new SessionEventValidationError(`template must be at most ${MAX_SESSION_EVENT_TEMPLATE_CHARS} characters`);
  }
  return value;
}

function checkRemindBefore(value: unknown): readonly number[] {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new SessionEventValidationError('remindBefore must be an array of milliseconds');
  const out = new Set<number>();
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0 || item > MAX_SESSION_EVENT_REMIND_BEFORE_MS) {
      throw new SessionEventValidationError('remindBefore entries must be positive integers up to 30 days (ms)');
    }
    out.add(item);
  }
  if (out.size > MAX_SESSION_EVENT_REMIND_OFFSETS) {
    throw new SessionEventValidationError(`remindBefore accepts at most ${MAX_SESSION_EVENT_REMIND_OFFSETS} offsets`);
  }
  return Object.freeze([...out].sort((a, b) => b - a));
}

function checkRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SessionEventValidationError('expectedRevision must be a non-negative integer');
  }
  return value;
}

/** 会话日程存储（每个 Agent 进程一份）。写入串行化；接表后先落库再生效。 */
export class AiSessionEvents {
  readonly #memory = new Map<string, SessionEventRecord>();
  readonly #listeners = new Set<() => void>();
  #model: SessionEventModel | undefined;
  #writes: Promise<unknown> = Promise.resolve();
  readonly #now: () => number;
  readonly #audit: () => SessionEventAuditSink | undefined;
  readonly #instanceId: string;

  constructor(options: SessionEventsOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#audit = options.audit ?? (() => undefined);
    this.#instanceId = options.instanceId ?? '*';
  }

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  /** 接上 `ai_session_events`；之后读写都以表为准。调度方会被通知重新排期（重启后的宕机补偿从这里开始）。 */
  async upgradeToDatabase(model: SessionEventModel): Promise<boolean> {
    this.#model = model;
    this.#notify();
    return true;
  }

  /** 事件变化（创建 / 修改 / 取消 / 接表）时通知调度方重新排期；返回退订函数。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  // ── 读取 ────────────────────────────────────────────────────────────────

  async get(id: string): Promise<SessionEventRecord | null> {
    return this.#load(id);
  }

  /** 某会话的事件，按事件时间升序；`status` 可选过滤。 */
  async list(input: Readonly<{ platform: string; sceneId: string; status?: SessionEventStatus }>): Promise<readonly SessionEventRecord[]> {
    const rows = await this.#query({ platform: input.platform, scene_id: input.sceneId, ...(input.status ? { status: input.status } : {}) });
    return Object.freeze(rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, MAX_SESSION_EVENT_LIST));
  }

  /** 所有 `scheduled` 的事件（调度用）。 */
  async listScheduled(): Promise<readonly SessionEventRecord[]> {
    const rows = await this.#query({ status: 'scheduled' });
    return Object.freeze(rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)));
  }

  // ── 迁移 ────────────────────────────────────────────────────────────────

  /** 创建（Console 或模型工具 `session_event_create`）：新建一行 `scheduled`。 */
  create(input: CreateSessionEventInput): Promise<SessionEventTransition> {
    return this.#serial(async () => {
      if (typeof input.platform !== 'string' || !input.platform.trim() || input.platform.length > 64) {
        throw new SessionEventValidationError('platform is required');
      }
      if (typeof input.sceneId !== 'string' || !SCENE_ID_PATTERN.test(input.sceneId) || input.sceneId.length > 256) {
        throw new SessionEventValidationError('sceneId must look like group:<id> or channel:<id>');
      }
      if (typeof input.createdBy !== 'string' || !input.createdBy.trim()) throw new SessionEventValidationError('createdBy is required');
      if (!(SESSION_EVENT_CREATED_VIA as readonly string[]).includes(input.createdVia)) {
        throw new SessionEventValidationError('createdVia must be console or model');
      }
      const now = this.#now();
      const title = checkTitle(input.title);
      const at = this.#checkAt(input.at, now);
      const remindBefore = checkRemindBefore(input.remindBefore);
      const template = checkTemplate(input.template);
      const skipped = pastOffsets({ at, remindBefore }, now);
      const record: SessionEventRecord = Object.freeze({
        id: randomUUID(),
        platform: input.platform,
        sceneId: input.sceneId,
        endpoint: input.endpoint?.trim() || null,
        title,
        at,
        remindBefore,
        template,
        status: 'scheduled',
        fired: Object.freeze(skipped),
        createdBy: input.createdBy,
        createdVia: input.createdVia,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.createdBy,
      });
      await this.#insert(record);
      const actor = input.createdVia === 'model'
        ? { actor: 'model' as const, actorId: input.createdBy }
        : { actor: 'operator' as const, actorId: input.createdBy };
      const transition = this.#transition(record, null, 'schedule_event_created', 'allow', actor, input.turnId, skipped.length ? { skippedOffsets: skipped } : undefined);
      this.#notify();
      return transition;
    });
  }

  /**
   * 修改（只经 Console）：标题 / 时间 / 提前量 / 模板。改了 `at` 或 `remind_before` 时重算 `fired`：
   * 只保留仍有效且已过去的偏移，未触发的偏移按新时间重新排期。终态不能改。
   */
  update(input: UpdateSessionEventInput): Promise<SessionEventTransition> {
    return this.#mutate(input, 'update', (current) => {
      if (current.status !== 'scheduled') throw new SessionEventStateError(current.status, 'update');
      const now = this.#now();
      const title = input.title === undefined ? current.title : checkTitle(input.title);
      const at = input.at === undefined ? current.at : this.#checkAt(input.at, now);
      const remindBefore = input.remindBefore === undefined ? current.remindBefore : checkRemindBefore(input.remindBefore);
      const template = input.template === undefined ? current.template : checkTemplate(input.template);
      const timing = at !== current.at || remindBefore.join(',') !== current.remindBefore.join(',');
      let fired = current.fired;
      let skipped: number[] = [];
      if (timing) {
        skipped = pastOffsets({ at, remindBefore }, now);
        fired = Object.freeze(skipped);
      }
      return {
        patch: { title, at, remindBefore, template, fired },
        reasonCode: 'schedule_event_updated',
        outcome: 'allow',
        payload: {
          ...(timing ? { previousAt: current.at, previousRemindBefore: [...current.remindBefore] } : {}),
          ...(skipped.length ? { skippedOffsets: skipped } : {}),
        },
      };
    });
  }

  /** 取消（只经 Console）：`scheduled` → `cancelled`（终态）。 */
  cancel(input: SessionEventMutationInput): Promise<SessionEventTransition> {
    return this.#mutate(input, 'cancel', (current) => {
      if (current.status !== 'scheduled') throw new SessionEventStateError(current.status, 'cancel');
      return { patch: { status: 'cancelled' }, reasonCode: 'schedule_event_cancelled', outcome: 'allow' };
    });
  }

  /**
   * 发送路径**先落账再发送**：把偏移记入 `fired`（认领），全部偏移都触发后置 `done`；返回本次认领到的偏移，
   * 已被记过（另一代路由 / 进程抢先）的偏移不再认领，保证同一提醒至多发一次。不写审计（触发结果由发送路径写）。
   * 事件已不是 `scheduled`（例如刚被取消）时什么也认领不到。
   */
  markFired(input: MarkSessionEventFiredInput): Promise<MarkSessionEventFiredResult> {
    return this.#serial(async () => {
      const current = await this.#load(input.id);
      if (!current || current.status !== 'scheduled') return Object.freeze({ record: current, claimed: Object.freeze([]) });
      const valid = new Set(sessionEventOffsets(current));
      const claimed = [...new Set(input.offsets)].filter((offset) => valid.has(offset) && !current.fired.includes(offset));
      if (claimed.length === 0) return Object.freeze({ record: current, claimed: Object.freeze([]) });
      const fired = [...new Set([...current.fired, ...claimed])].sort((a, b) => b - a);
      const done = [...valid].every((offset) => fired.includes(offset));
      const next = this.#next(current, { fired: Object.freeze(fired), ...(done ? { status: 'done' as const } : {}) }, 'system');
      await this.#update(next, current.revision);
      return Object.freeze({ record: next, claimed: Object.freeze(claimed) });
    });
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  #checkAt(value: unknown, now: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new SessionEventValidationError('at must be a unix timestamp in milliseconds');
    }
    if (value <= now) throw new SessionEventValidationError('at must be in the future');
    if (value > now + MAX_SESSION_EVENT_HORIZON_MS) throw new SessionEventValidationError('at must be within one year');
    return value;
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* 调度方的问题不影响存储 */ }
    }
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(run);
    this.#writes = next.catch(() => undefined);
    return next;
  }

  #mutate(
    input: SessionEventMutationInput,
    action: string,
    plan: (current: SessionEventRecord) => {
      patch: Partial<SessionEventRecord>;
      reasonCode: DecisionReasonCode;
      outcome: DecisionOutcome;
      payload?: Record<string, unknown>;
    },
  ): Promise<SessionEventTransition> {
    return this.#serial(async () => {
      if (typeof input.id !== 'string' || !input.id) throw new SessionEventValidationError('id is required');
      const expected = checkRevision(input.expectedRevision);
      if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new SessionEventValidationError('actorId is required');
      const current = await this.#load(input.id);
      if (!current) throw new SessionEventNotFoundError(input.id);
      if (current.revision !== expected) throw new SessionEventRevisionConflictError(current.revision);
      const step = plan(current);
      const next = this.#next(current, step.patch, input.actorId);
      await this.#update(next, current.revision);
      const transition = this.#transition(next, current.status, step.reasonCode, step.outcome, { actor: 'operator', actorId: input.actorId }, input.turnId, step.payload);
      this.#notify();
      return transition;
    });
  }

  #next(current: SessionEventRecord, patch: Partial<SessionEventRecord>, actorId: string | null): SessionEventRecord {
    return Object.freeze({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: this.#now(),
      updatedBy: actorId ?? current.updatedBy,
    });
  }

  #transition(
    record: SessionEventRecord,
    from: SessionEventStatus | null,
    reasonCode: DecisionReasonCode,
    outcome: DecisionOutcome,
    actor: Readonly<{ actor: DecisionActor; actorId?: string | null }>,
    turnId?: string,
    payload?: Record<string, unknown>,
  ): SessionEventTransition {
    const id = turnId ?? randomUUID();
    let sink: SessionEventAuditSink | undefined;
    try { sink = this.#audit(); } catch { sink = undefined; }
    if (sink) {
      try {
        const result = sink.record({
          turnId: id,
          instanceId: record.endpoint || record.platform || this.#instanceId,
          platform: record.platform,
          sceneId: record.sceneId,
          kind: 'schedule',
          outcome,
          reasonCode,
          payload: {
            eventId: record.id,
            from,
            to: record.status,
            revision: record.revision,
            title: record.title,
            at: record.at,
            remindBefore: [...record.remindBefore],
            createdVia: record.createdVia,
            ...(payload ?? {}),
          },
          actor: actor.actor,
          ...(actor.actorId ? { actorId: actor.actorId } : {}),
        });
        if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
      } catch {
        // 审计不是门禁。
      }
    }
    return Object.freeze({ record, from, to: record.status, reasonCode, turnId: id });
  }

  async #load(id: string): Promise<SessionEventRecord | null> {
    const model = this.#model;
    if (!model) return this.#memory.get(id) ?? null;
    try {
      const rows = await model.select().where({ id });
      return rows[0] ? sessionEventFromRow(rows[0]) : null;
    } catch (error) {
      throw new SessionEventUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #query(condition: Record<string, unknown>): Promise<SessionEventRecord[]> {
    const model = this.#model;
    if (!model) {
      return [...this.#memory.values()].filter((record) => {
        const row = sessionEventToRow(record);
        return Object.entries(condition).every(([key, value]) => row[key] === value);
      });
    }
    try {
      const rows = await model.select().where(condition);
      return rows.map(sessionEventFromRow);
    } catch (error) {
      throw new SessionEventUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #insert(record: SessionEventRecord): Promise<void> {
    const model = this.#model;
    if (!model) {
      this.#memory.set(record.id, record);
      this.#evict();
      return;
    }
    try {
      await model.create(sessionEventToRow(record));
    } catch (error) {
      throw new SessionEventUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #update(record: SessionEventRecord, expectedRevision: number): Promise<void> {
    const model = this.#model;
    if (!model) {
      const current = this.#memory.get(record.id);
      if (!current) throw new SessionEventNotFoundError(record.id);
      if (current.revision !== expectedRevision) throw new SessionEventRevisionConflictError(current.revision);
      this.#memory.set(record.id, record);
      return;
    }
    const { id, ...rest } = sessionEventToRow(record);
    try {
      await model.update(rest).where({ id, revision: expectedRevision });
    } catch (error) {
      throw new SessionEventUnavailableError(error instanceof Error ? error.message : String(error));
    }
    // 乐观并发：读回确认本次写入生效。
    const stored = await this.#load(record.id);
    if (!stored) throw new SessionEventNotFoundError(record.id);
    if (stored.revision !== record.revision || stored.status !== record.status || stored.fired.join(',') !== record.fired.join(',')) {
      throw new SessionEventRevisionConflictError(stored.revision);
    }
  }

  #evict(): void {
    if (this.#memory.size <= MAX_IN_MEMORY_SESSION_EVENTS) return;
    for (const [id, record] of this.#memory) {
      if (this.#memory.size <= MAX_IN_MEMORY_SESSION_EVENTS) break;
      if (record.status !== 'scheduled') this.#memory.delete(id);
    }
  }
}

/** 创建 / 修改时已经过去的偏移（直接记为已触发，不发、不算 missed）。 */
function pastOffsets(input: Readonly<{ at: number; remindBefore: readonly number[] }>, now: number): number[] {
  return sessionEventOffsets(input).filter((offset) => input.at - offset <= now);
}

// ── 计时 ──────────────────────────────────────────────────────────────────

/** 会话日程的计时口：到点回调一次。复用 job-scheduler 的 `ScheduleEngine`（`at` 任务），但不写 `schedule-jobs.json`。 */
export interface SessionEventTimer {
  /** 在 `atMs` 回调 `run`；同一 `id` 重复注册时替换旧的。返回取消函数。 */
  at(id: string, atMs: number, run: () => void | Promise<void>): () => void;
  dispose(): void;
}

export function createSessionEventTimer(options: Readonly<{ timezone?: string; onError?: (error: Error, id: string) => void }> = {}): SessionEventTimer {
  const engine = new ScheduleEngine({
    timezone: options.timezone ?? DEFAULT_SESSION_EVENT_TIMEZONE,
    ...(options.onError ? { onError: options.onError } : {}),
  });
  return {
    at(id, atMs, run) {
      // ScheduleEngine 不登记已过去的 `at`：调用方自己先处理到期的提醒。
      const target = Math.max(atMs, Date.now() + 1);
      return engine.register(id, 'at', async () => { await run(); }, { atMs: target });
    },
    dispose() {
      engine.dispose();
    },
  };
}
