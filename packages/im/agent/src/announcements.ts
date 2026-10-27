/**
 * 公告：草稿 → 审批 → 发送（ADR 0037 §1.2，第 1 期切片 B）。
 *
 * - 新表 `ai_announcements`：每条公告一行，`revision` 乐观并发（与控制面 `expectedRevision` 同约定）。
 * - 状态：`draft` → `pending` → `approved` → `sent`；旁路 `rejected` / `expired` / `failed`。
 *   - 改正文（任何非终态）一律回到 `draft` 并重算 `content_hash`，清掉旧审批。
 *   - 提交：`draft` → `pending`（只经 Console；模型工具 `announcement_draft` 只能建草稿）。
 *   - 审批：`pending` → `approved`（记 `approved_by` / `approved_at`，`approved_hash` = 当时的 `content_hash`）；
 *     驳回：`pending` → `rejected`；`pending` 超过审批时限（默认 24 小时）→ `expired`。
 *   - 发送只从 `approved` 出发：成功 → `sent`；失败 / 被拦 / 摘要不符 → `failed`，**不自动重试**。
 *   - 重发（设计取舍）：`failed` → `pending`，清掉旧审批并写 `announcement_resend`；之后必须**再走一次审批**才会发送。
 *     这样「重发」本身是一次新的人工动作、且重新绑定一次审批记录（ADR 0037 §0.3 / §0.4）。
 *   - 终态：`sent` / `rejected` / `expired`；终态不能再改、不能再提交。
 * - 每次状态迁移写一行 `kind=announcement` 审计，`reason_code` 为 `announcement_*`；审计写失败不影响迁移。
 * - 持久化：接上表后以表为准（先落库再生效）；未接表时只存进程内（测试 / 无数据库）。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DecisionActor, DecisionEventInput, DecisionOutcome, DecisionReasonCode } from './decision-events.js';

export const AI_ANNOUNCEMENTS_TABLE = 'ai_announcements';
/** 审批默认时限：24 小时（ADR 0037「待 Fin 确认的默认值」）。 */
export const DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ANNOUNCEMENT_CONTENT_CHARS = 2_000;
export const MAX_ANNOUNCEMENT_ERROR_CHARS = 200;
/** 未接数据库时进程内最多保留多少条（超出时淘汰最旧的终态行）。 */
export const MAX_IN_MEMORY_ANNOUNCEMENTS = 2_000;
/** 一次列表最多返回多少条。 */
export const MAX_ANNOUNCEMENT_LIST = 200;

export const ANNOUNCEMENT_STATUSES = ['draft', 'pending', 'approved', 'sent', 'rejected', 'expired', 'failed'] as const;
export type AnnouncementStatus = typeof ANNOUNCEMENT_STATUSES[number];
export const ANNOUNCEMENT_TERMINAL_STATUSES: readonly AnnouncementStatus[] = Object.freeze(['sent', 'rejected', 'expired']);
export const ANNOUNCEMENT_CREATED_VIA = ['console', 'model'] as const;
export type AnnouncementCreatedVia = typeof ANNOUNCEMENT_CREATED_VIA[number];

export const AI_ANNOUNCEMENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  /** 起草时的 Bot 账号（模型起草时取当前回合的 endpoint）；为空时发送端按平台唯一在线账号解析。 */
  endpoint: { type: 'text' as const, nullable: true },
  content: { type: 'text' as const, nullable: false },
  content_hash: { type: 'text' as const, nullable: false },
  /** 审批时绑定的摘要；发送前必须与当前正文的 sha256 一致。 */
  approved_hash: { type: 'text' as const, nullable: true },
  status: { type: 'text' as const, nullable: false, default: 'draft' },
  created_by: { type: 'text' as const, nullable: false },
  created_via: { type: 'text' as const, nullable: false },
  approved_by: { type: 'text' as const, nullable: true },
  approved_at: { type: 'bigint' as const, nullable: true },
  submitted_at: { type: 'bigint' as const, nullable: true },
  sent_at: { type: 'bigint' as const, nullable: true },
  revision: { type: 'bigint' as const, nullable: false, default: 0 },
  error: { type: 'text' as const, nullable: true },
  created_at: { type: 'bigint' as const, nullable: false },
  updated_at: { type: 'bigint' as const, nullable: false },
  updated_by: { type: 'text' as const, nullable: true },
};

export interface AnnouncementRecord {
  readonly id: string;
  readonly platform: string;
  /** `<scope>:<sceneId>`，与会话画像 `sceneKey` 同口径，只接受 `group` / `channel`。 */
  readonly sceneId: string;
  readonly endpoint: string | null;
  readonly content: string;
  readonly contentHash: string;
  readonly approvedHash: string | null;
  readonly status: AnnouncementStatus;
  readonly createdBy: string;
  readonly createdVia: AnnouncementCreatedVia;
  readonly approvedBy: string | null;
  readonly approvedAt: number | null;
  readonly submittedAt: number | null;
  readonly sentAt: number | null;
  readonly revision: number;
  readonly error: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
}

export class AnnouncementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementValidationError';
  }
}

export class AnnouncementNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`announcement ${id} not found`);
    this.id = id;
    this.name = 'AnnouncementNotFoundError';
  }
}

export class AnnouncementRevisionConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super(`announcement revision conflict: current revision is ${currentRevision}`);
    this.currentRevision = currentRevision;
    this.name = 'AnnouncementRevisionConflictError';
  }
}

/** 当前状态不允许该迁移（例如对 `sent` 改正文、对 `draft` 审批）。 */
export class AnnouncementStateError extends Error {
  readonly status: AnnouncementStatus;
  readonly action: string;
  constructor(status: AnnouncementStatus, action: string) {
    super(`announcement in status ${status} cannot ${action}`);
    this.status = status;
    this.action = action;
    this.name = 'AnnouncementStateError';
  }
}

export class AnnouncementUnavailableError extends Error {
  constructor(message = 'announcement storage is unavailable') {
    super(message);
    this.name = 'AnnouncementUnavailableError';
  }
}

export function announcementContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function isAnnouncementTerminal(status: AnnouncementStatus): boolean {
  return ANNOUNCEMENT_TERMINAL_STATUSES.includes(status);
}

const SCENE_ID_PATTERN = /^(group|channel):.+/u;

function isStatus(value: unknown): value is AnnouncementStatus {
  return typeof value === 'string' && (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function announcementFromRow(row: Record<string, unknown>): AnnouncementRecord {
  const status = isStatus(row.status) ? row.status : 'failed';
  const createdVia = row.created_via === 'model' ? 'model' : 'console';
  return Object.freeze({
    id: String(row.id),
    platform: String(row.platform ?? ''),
    sceneId: String(row.scene_id ?? ''),
    endpoint: str(row.endpoint) || null,
    content: String(row.content ?? ''),
    contentHash: String(row.content_hash ?? ''),
    approvedHash: str(row.approved_hash),
    status,
    createdBy: String(row.created_by ?? ''),
    createdVia,
    approvedBy: str(row.approved_by),
    approvedAt: num(row.approved_at),
    submittedAt: num(row.submitted_at),
    sentAt: num(row.sent_at),
    revision: num(row.revision) ?? 0,
    error: str(row.error),
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
    updatedBy: str(row.updated_by),
  });
}

export function announcementToRow(record: AnnouncementRecord): Record<string, unknown> {
  return {
    id: record.id,
    platform: record.platform,
    scene_id: record.sceneId,
    endpoint: record.endpoint,
    content: record.content,
    content_hash: record.contentHash,
    approved_hash: record.approvedHash,
    status: record.status,
    created_by: record.createdBy,
    created_via: record.createdVia,
    approved_by: record.approvedBy,
    approved_at: record.approvedAt,
    submitted_at: record.submittedAt,
    sent_at: record.sentAt,
    revision: record.revision,
    error: record.error,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    updated_by: record.updatedBy,
  };
}

/** 表模型的最小形状（与其他 `ai_*` 表同约定）。 */
export interface AnnouncementModel {
  select(): { where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]> };
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

/** 审计写入口（`DecisionEventLog.record` 结构兼容）；写失败不得影响迁移。 */
export interface AnnouncementAuditSink {
  record(input: DecisionEventInput): unknown;
}

export interface AnnouncementTransition {
  readonly record: AnnouncementRecord;
  readonly from: AnnouncementStatus | null;
  readonly to: AnnouncementStatus;
  readonly reasonCode: DecisionReasonCode;
  readonly turnId: string;
}

/** 操作者：Console 用户 / 模型（只能起草）/ 策略（过期）/ 系统（发送结果）。 */
export interface AnnouncementActor {
  readonly actor: DecisionActor;
  readonly actorId?: string | null;
}

export interface AnnouncementOptions {
  readonly now?: () => number;
  readonly approvalTtlMs?: number;
  readonly audit?: () => AnnouncementAuditSink | undefined;
  readonly instanceId?: string;
}

export interface CreateAnnouncementInput {
  readonly platform: string;
  readonly sceneId: string;
  readonly content: string;
  readonly createdBy: string;
  readonly createdVia: AnnouncementCreatedVia;
  readonly endpoint?: string | null;
  readonly turnId?: string;
}

export interface AnnouncementMutationInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly actorId: string;
  readonly turnId?: string;
}

/** 发送结果落账（只由发送路径调用）。 */
export interface AnnouncementSendResultInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly turnId?: string;
  /** 失败时：`announcement_send_failed`（outcome=error）、`announcement_hash_mismatch`（deny）或沿用的 `control_*` / `cannot_speak_*`（skip）。 */
  readonly reasonCode?: DecisionReasonCode;
  readonly outcome?: DecisionOutcome;
  readonly error?: string;
  readonly payload?: Record<string, unknown>;
}

function checkText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new AnnouncementValidationError(`${label} must not be empty`);
  if (Array.from(value).length > max) throw new AnnouncementValidationError(`${label} must be at most ${max} characters`);
  return value;
}

function checkRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AnnouncementValidationError('expectedRevision must be a non-negative integer');
  }
  return value;
}

export function clipAnnouncementError(message: string): string {
  const chars = Array.from(message);
  return chars.length <= MAX_ANNOUNCEMENT_ERROR_CHARS ? message : chars.slice(0, MAX_ANNOUNCEMENT_ERROR_CHARS).join('');
}

/** 公告存储与状态机（每个 Agent 进程一份）。写入串行化；接表后先落库再生效。 */
export class AiAnnouncements {
  readonly #memory = new Map<string, AnnouncementRecord>();
  #model: AnnouncementModel | undefined;
  #writes: Promise<unknown> = Promise.resolve();
  readonly #now: () => number;
  readonly approvalTtlMs: number;
  readonly #audit: () => AnnouncementAuditSink | undefined;
  readonly #instanceId: string;

  constructor(options: AnnouncementOptions = {}) {
    this.#now = options.now ?? Date.now;
    const ttl = options.approvalTtlMs;
    this.approvalTtlMs = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? Math.trunc(ttl) : DEFAULT_ANNOUNCEMENT_APPROVAL_TTL_MS;
    this.#audit = options.audit ?? (() => undefined);
    this.#instanceId = options.instanceId ?? '*';
  }

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  /** 接上 `ai_announcements`；之后读写都以表为准。 */
  async upgradeToDatabase(model: AnnouncementModel): Promise<boolean> {
    this.#model = model;
    return true;
  }

  // ── 读取 ────────────────────────────────────────────────────────────────

  async get(id: string): Promise<AnnouncementRecord | null> {
    await this.expireDue();
    return this.#load(id);
  }

  /** 某会话的公告，按创建时间倒序；`status` 可选过滤。 */
  async list(input: Readonly<{ platform: string; sceneId: string; status?: AnnouncementStatus }>): Promise<readonly AnnouncementRecord[]> {
    await this.expireDue();
    const rows = await this.#query({ platform: input.platform, scene_id: input.sceneId, ...(input.status ? { status: input.status } : {}) });
    return Object.freeze(rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, MAX_ANNOUNCEMENT_LIST));
  }

  // ── 迁移 ────────────────────────────────────────────────────────────────

  /** 起草（Console 或模型工具）：新建一行 `draft`。 */
  create(input: CreateAnnouncementInput): Promise<AnnouncementTransition> {
    return this.#serial(async () => {
      if (typeof input.platform !== 'string' || !input.platform.trim() || input.platform.length > 64) {
        throw new AnnouncementValidationError('platform is required');
      }
      if (typeof input.sceneId !== 'string' || !SCENE_ID_PATTERN.test(input.sceneId) || input.sceneId.length > 256) {
        throw new AnnouncementValidationError('sceneId must look like group:<id> or channel:<id>');
      }
      const content = checkText(input.content, 'content', MAX_ANNOUNCEMENT_CONTENT_CHARS);
      if (typeof input.createdBy !== 'string' || !input.createdBy.trim()) throw new AnnouncementValidationError('createdBy is required');
      if (!(ANNOUNCEMENT_CREATED_VIA as readonly string[]).includes(input.createdVia)) {
        throw new AnnouncementValidationError('createdVia must be console or model');
      }
      const now = this.#now();
      const record: AnnouncementRecord = Object.freeze({
        id: randomUUID(),
        platform: input.platform,
        sceneId: input.sceneId,
        endpoint: input.endpoint?.trim() || null,
        content,
        contentHash: announcementContentHash(content),
        approvedHash: null,
        status: 'draft',
        createdBy: input.createdBy,
        createdVia: input.createdVia,
        approvedBy: null,
        approvedAt: null,
        submittedAt: null,
        sentAt: null,
        revision: 1,
        error: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.createdBy,
      });
      await this.#insert(record);
      const actor: AnnouncementActor = input.createdVia === 'model'
        ? { actor: 'model', actorId: input.createdBy }
        : { actor: 'operator', actorId: input.createdBy };
      return this.#transition(record, null, 'announcement_drafted', 'allow', actor, input.turnId);
    });
  }

  /** 改正文：任何非终态都回到 `draft`，重算摘要并清掉审批与错误。 */
  edit(input: AnnouncementMutationInput & { readonly content: string }): Promise<AnnouncementTransition> {
    return this.#mutate(input, 'edit', (current) => {
      if (isAnnouncementTerminal(current.status)) throw new AnnouncementStateError(current.status, 'edit');
      const content = checkText(input.content, 'content', MAX_ANNOUNCEMENT_CONTENT_CHARS);
      return {
        patch: { content, contentHash: announcementContentHash(content), status: 'draft', approvedHash: null, approvedBy: null, approvedAt: null, submittedAt: null, error: null },
        reasonCode: 'announcement_drafted',
        outcome: 'allow',
        payload: { edited: true },
      };
    });
  }

  /** 提交审批：`draft` → `pending`。 */
  submit(input: AnnouncementMutationInput): Promise<AnnouncementTransition> {
    return this.#mutate(input, 'submit', (current) => {
      if (current.status !== 'draft') throw new AnnouncementStateError(current.status, 'submit');
      return { patch: { status: 'pending', submittedAt: this.#now() }, reasonCode: 'announcement_submitted', outcome: 'defer' };
    });
  }

  /** 批准：`pending` → `approved`，审批绑定当时的 `content_hash`。 */
  approve(input: AnnouncementMutationInput): Promise<AnnouncementTransition> {
    return this.#mutate(input, 'approve', (current) => {
      if (current.status !== 'pending') throw new AnnouncementStateError(current.status, 'approve');
      return {
        patch: { status: 'approved', approvedBy: input.actorId, approvedAt: this.#now(), approvedHash: current.contentHash, error: null },
        reasonCode: 'announcement_approved',
        outcome: 'allow',
      };
    });
  }

  /** 驳回：`pending` → `rejected`（终态）。 */
  reject(input: AnnouncementMutationInput & { readonly reason?: string }): Promise<AnnouncementTransition> {
    return this.#mutate(input, 'reject', (current) => {
      if (current.status !== 'pending') throw new AnnouncementStateError(current.status, 'reject');
      const reason = typeof input.reason === 'string' && input.reason.trim() ? clipAnnouncementError(input.reason.trim()) : null;
      return { patch: { status: 'rejected', error: reason }, reasonCode: 'announcement_rejected', outcome: 'deny' };
    });
  }

  /**
   * 重发：`failed` → `pending`，清掉旧审批；之后必须再批准一次才会发送（重新绑定审批记录）。
   */
  resend(input: AnnouncementMutationInput): Promise<AnnouncementTransition> {
    return this.#mutate(input, 'resend', (current) => {
      if (current.status !== 'failed') throw new AnnouncementStateError(current.status, 'resend');
      return {
        patch: { status: 'pending', submittedAt: this.#now(), approvedHash: null, approvedBy: null, approvedAt: null },
        reasonCode: 'announcement_resend',
        outcome: 'defer',
        payload: { previousError: current.error },
      };
    });
  }

  /** 发送成功：`approved` → `sent`（只由发送路径调用）。 */
  markSent(input: AnnouncementSendResultInput): Promise<AnnouncementTransition> {
    return this.#mutate({ ...input, actorId: 'system' }, 'mark sent', (current) => {
      if (current.status !== 'approved') throw new AnnouncementStateError(current.status, 'mark sent');
      return { patch: { status: 'sent', sentAt: this.#now(), error: null }, reasonCode: 'announcement_sent', outcome: 'allow', payload: input.payload };
    }, { actor: 'system' });
  }

  /** 发送失败 / 被拦 / 摘要不符：`approved` → `failed`，**不自动重试**。 */
  markFailed(input: AnnouncementSendResultInput): Promise<AnnouncementTransition> {
    return this.#mutate({ ...input, actorId: 'system' }, 'mark failed', (current) => {
      if (current.status !== 'approved') throw new AnnouncementStateError(current.status, 'mark failed');
      return {
        patch: { status: 'failed', error: clipAnnouncementError(input.error?.trim() || 'send_failed') },
        reasonCode: input.reasonCode ?? 'announcement_send_failed',
        outcome: input.outcome ?? 'error',
        payload: input.payload,
      };
    }, { actor: input.reasonCode && input.reasonCode !== 'announcement_send_failed' ? 'policy' : 'system' });
  }

  /** 把超过审批时限的 `pending` 置为 `expired`（读取时顺带执行；宿主也可定时调用）。 */
  expireDue(): Promise<readonly AnnouncementTransition[]> {
    return this.#serial(async () => {
      const cutoff = this.#now() - this.approvalTtlMs;
      const pending = await this.#query({ status: 'pending' });
      const out: AnnouncementTransition[] = [];
      for (const current of pending) {
        const since = current.submittedAt ?? current.updatedAt;
        if (since > cutoff) continue;
        const next = this.#next(current, { status: 'expired' }, null);
        await this.#update(next, current.revision);
        out.push(this.#transition(next, current.status, 'announcement_expired', 'skip', { actor: 'policy' }, undefined, { approvalTtlMs: this.approvalTtlMs }));
      }
      return Object.freeze(out);
    });
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(run);
    this.#writes = next.catch(() => undefined);
    return next;
  }

  #mutate(
    input: AnnouncementMutationInput,
    action: string,
    plan: (current: AnnouncementRecord) => {
      patch: Partial<AnnouncementRecord>;
      reasonCode: DecisionReasonCode;
      outcome: DecisionOutcome;
      payload?: Record<string, unknown>;
    },
    actor?: AnnouncementActor,
  ): Promise<AnnouncementTransition> {
    return this.#serial(async () => {
      if (typeof input.id !== 'string' || !input.id) throw new AnnouncementValidationError('id is required');
      const expected = checkRevision(input.expectedRevision);
      if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new AnnouncementValidationError('actorId is required');
      const current = await this.#load(input.id);
      if (!current) throw new AnnouncementNotFoundError(input.id);
      // 先过期：超时的 pending 不能再被批准 / 驳回。
      if (current.status === 'pending' && (current.submittedAt ?? current.updatedAt) <= this.#now() - this.approvalTtlMs) {
        const expired = this.#next(current, { status: 'expired' }, null);
        await this.#update(expired, current.revision);
        this.#transition(expired, 'pending', 'announcement_expired', 'skip', { actor: 'policy' }, undefined, { approvalTtlMs: this.approvalTtlMs });
        throw new AnnouncementStateError('expired', action);
      }
      if (current.revision !== expected) throw new AnnouncementRevisionConflictError(current.revision);
      const step = plan(current);
      const next = this.#next(current, step.patch, input.actorId);
      await this.#update(next, current.revision);
      return this.#transition(next, current.status, step.reasonCode, step.outcome, actor ?? { actor: 'operator', actorId: input.actorId }, input.turnId, step.payload);
    });
  }

  #next(current: AnnouncementRecord, patch: Partial<AnnouncementRecord>, actorId: string | null): AnnouncementRecord {
    return Object.freeze({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: this.#now(),
      updatedBy: actorId ?? current.updatedBy,
    });
  }

  #transition(
    record: AnnouncementRecord,
    from: AnnouncementStatus | null,
    reasonCode: DecisionReasonCode,
    outcome: DecisionOutcome,
    actor: AnnouncementActor,
    turnId?: string,
    payload?: Record<string, unknown>,
  ): AnnouncementTransition {
    const id = turnId ?? randomUUID();
    let sink: AnnouncementAuditSink | undefined;
    try { sink = this.#audit(); } catch { sink = undefined; }
    if (sink) {
      try {
        const result = sink.record({
          turnId: id,
          // 与回合审计同口径：Bot 实例用 endpoint（Bot 账号），缺省回落平台名。
          instanceId: record.endpoint || record.platform || this.#instanceId,
          platform: record.platform,
          sceneId: record.sceneId,
          kind: 'announcement',
          outcome,
          reasonCode,
          ...(record.error && (record.status === 'failed' || record.status === 'rejected') ? { reasonDetail: record.error } : {}),
          payload: {
            announcementId: record.id,
            from,
            to: record.status,
            revision: record.revision,
            contentHash: record.contentHash,
            ...(record.approvedHash ? { approvedHash: record.approvedHash } : {}),
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

  async #load(id: string): Promise<AnnouncementRecord | null> {
    const model = this.#model;
    if (!model) return this.#memory.get(id) ?? null;
    try {
      const rows = await model.select().where({ id });
      return rows[0] ? announcementFromRow(rows[0]) : null;
    } catch (error) {
      throw new AnnouncementUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #query(condition: Record<string, unknown>): Promise<AnnouncementRecord[]> {
    const model = this.#model;
    if (!model) {
      return [...this.#memory.values()].filter((record) => {
        const row = announcementToRow(record);
        return Object.entries(condition).every(([key, value]) => row[key] === value);
      });
    }
    try {
      const rows = await model.select().where(condition);
      return rows.map(announcementFromRow);
    } catch (error) {
      throw new AnnouncementUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #insert(record: AnnouncementRecord): Promise<void> {
    const model = this.#model;
    if (!model) {
      this.#memory.set(record.id, record);
      this.#evict();
      return;
    }
    try {
      await model.create(announcementToRow(record));
    } catch (error) {
      throw new AnnouncementUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async #update(record: AnnouncementRecord, expectedRevision: number): Promise<void> {
    const model = this.#model;
    if (!model) {
      const current = this.#memory.get(record.id);
      if (!current) throw new AnnouncementNotFoundError(record.id);
      if (current.revision !== expectedRevision) throw new AnnouncementRevisionConflictError(current.revision);
      this.#memory.set(record.id, record);
      return;
    }
    const { id, ...rest } = announcementToRow(record);
    try {
      await model.update(rest).where({ id, revision: expectedRevision });
    } catch (error) {
      throw new AnnouncementUnavailableError(error instanceof Error ? error.message : String(error));
    }
    // 乐观并发：读回确认本次写入生效（另一进程先写时 revision 不会是我们的值）。
    const stored = await this.#load(record.id);
    if (!stored) throw new AnnouncementNotFoundError(record.id);
    if (stored.revision !== record.revision || stored.status !== record.status || stored.contentHash !== record.contentHash) {
      throw new AnnouncementRevisionConflictError(stored.revision);
    }
  }

  #evict(): void {
    if (this.#memory.size <= MAX_IN_MEMORY_ANNOUNCEMENTS) return;
    for (const [id, record] of this.#memory) {
      if (this.#memory.size <= MAX_IN_MEMORY_ANNOUNCEMENTS) break;
      if (isAnnouncementTerminal(record.status)) this.#memory.delete(id);
    }
  }
}
