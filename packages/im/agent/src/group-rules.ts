/**
 * 动态群管规则：起草 → 审批 → 生效（ADR 0039 §1，切片 A）。
 *
 * - 新表 `ai_group_rules`：每条规则一行，`revision` 乐观并发（与控制面 `expectedRevision` 同约定）。
 * - 状态只前进：`draft` → `pending` → `active`；旁路 `rejected` / `expired` / `disabled`（终态）。
 *   - 改规则（`draft` / `pending`）一律回到 `draft` 并重算 `content_hash`，清掉旧审批（ADR 0037 §0.3）。
 *     `active` 不可改：放宽 = 停用后另起新规则，更严 = 新规则重新审批（ADR 0039 §3.5）。
 *   - 批准：`pending` → `active`，可带审批卡上看到的 `contentHash`，与当前不符 → `rule_hash_mismatch` 并拒绝。
 *     同一 `platform + scene_id + trigger` 同时最多一条 `active`：批准新规则时旧规则 → `disabled`（`rule_superseded`）。
 *   - 驳回：`pending` → `rejected`；`pending` 超过审批时限（默认 24 小时）→ `expired`。
 *   - 停用：`draft` / `pending` / `active` → `disabled`，不需要审批。
 * - 每次状态迁移写一行 `kind=group_rule` 审计；审计写失败不影响迁移。
 * - 谁能起草 / 审批（实时群主 / 管理员）与执行器不在本切片（见切片 B / C）。
 * - 磁盘有界：单条规则字段有上限；每会话未终结规则（`draft` + `pending`）有上限；
 *   进入终态即清空人读摘要 `content`；终态行超过保留期（默认 30 天）或超过每会话保留条数即删除（{@link AiGroupRules.prune}）。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DecisionActor, DecisionEventInput, DecisionOutcome, DecisionReasonCode } from './decision-events.js';

export const AI_GROUP_RULES_TABLE = 'ai_group_rules';
/** 审批默认时限：24 小时（ADR 0039「待 Fin 确认的默认值」）。 */
export const DEFAULT_GROUP_RULE_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
/** 冷静期默认 30 分钟：超过此时长无再犯，阶梯归零。 */
export const DEFAULT_GROUP_RULE_WINDOW_MS = 30 * 60 * 1000;
export const MIN_GROUP_RULE_WINDOW_MS = 60 * 1000;
export const MAX_GROUP_RULE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 禁言时长范围：60 秒 – 24 小时。 */
export const MIN_GROUP_RULE_MUTE_SEC = 60;
export const MAX_GROUP_RULE_MUTE_SEC = 86_400;
export const MAX_GROUP_RULE_LADDER_STAGES = 5;
export const MAX_GROUP_RULE_CONTENT_CHARS = 500;
export const MAX_GROUP_RULE_EXEMPT_USERS = 100;
export const MAX_GROUP_RULE_REASON_CHARS = 200;
/** 每会话同时存在的未终结规则（`draft` + `pending`）上限，防止起草刷表。 */
export const MAX_OPEN_GROUP_RULES_PER_SCENE = 20;
/** 终态行默认保留天数。 */
export const DEFAULT_GROUP_RULE_RETENTION_DAYS = 30;
/** 每会话最多保留多少条终态行（超出删最旧的）。 */
export const MAX_TERMINAL_GROUP_RULES_PER_SCENE = 50;
/** 未接数据库时进程内最多保留多少条（超出时淘汰最旧的终态行）。 */
export const MAX_IN_MEMORY_GROUP_RULES = 2_000;
export const MAX_GROUP_RULE_LIST = 200;

export const GROUP_RULE_TRIGGERS = ['advertising', 'abuse', 'flood'] as const;
export type GroupRuleTrigger = typeof GROUP_RULE_TRIGGERS[number];
export const GROUP_RULE_ACTIONS = ['remind', 'warn', 'mute', 'suggest_kick'] as const;
export type GroupRuleAction = typeof GROUP_RULE_ACTIONS[number];
export const GROUP_RULE_STATUSES = ['draft', 'pending', 'active', 'rejected', 'expired', 'disabled'] as const;
export type GroupRuleStatus = typeof GROUP_RULE_STATUSES[number];
export const GROUP_RULE_TERMINAL_STATUSES: readonly GroupRuleStatus[] = Object.freeze(['rejected', 'expired', 'disabled']);
export const GROUP_RULE_CREATED_VIA = ['im', 'console', 'model'] as const;
export type GroupRuleCreatedVia = typeof GROUP_RULE_CREATED_VIA[number];
export const GROUP_RULE_APPROVED_VIA = ['im', 'console'] as const;
export type GroupRuleApprovedVia = typeof GROUP_RULE_APPROVED_VIA[number];

export interface GroupRuleStage {
  readonly action: GroupRuleAction;
  /** 只有 `mute` 有，60–86400 秒。 */
  readonly durationSec?: number;
}

export interface GroupRuleExempt {
  /** 群主 / 管理员豁免（默认 true）。 */
  readonly ownerAndAdmins: boolean;
  /** 额外白名单（成员 id，去重排序）。 */
  readonly userIds: readonly string[];
}

export const DEFAULT_GROUP_RULE_EXEMPT: GroupRuleExempt = Object.freeze({ ownerAndAdmins: true, userIds: Object.freeze([]) as readonly string[] });

export const AI_GROUP_RULE_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  /** ADR 0039 §1 的 `trigger`；列名避开 SQL 保留字 TRIGGER。 */
  rule_trigger: { type: 'text' as const, nullable: false },
  /** JSON：`GroupRuleStage[]`。 */
  ladder: { type: 'text' as const, nullable: false },
  window_ms: { type: 'bigint' as const, nullable: false },
  /** JSON：`GroupRuleExempt`。 */
  exempt: { type: 'text' as const, nullable: false },
  content: { type: 'text' as const, nullable: false, default: '' },
  content_hash: { type: 'text' as const, nullable: false },
  status: { type: 'text' as const, nullable: false, default: 'draft' },
  created_by: { type: 'text' as const, nullable: false },
  created_via: { type: 'text' as const, nullable: false },
  approved_by: { type: 'text' as const, nullable: true },
  approved_at: { type: 'bigint' as const, nullable: true },
  approved_via: { type: 'text' as const, nullable: true },
  submitted_at: { type: 'bigint' as const, nullable: true },
  revision: { type: 'bigint' as const, nullable: false, default: 0 },
  reason: { type: 'text' as const, nullable: true },
  created_at: { type: 'bigint' as const, nullable: false },
  updated_at: { type: 'bigint' as const, nullable: false },
  updated_by: { type: 'text' as const, nullable: true },
};

export interface GroupRuleRecord {
  readonly id: string;
  readonly platform: string;
  /** `group:<id>`，与会话画像 `sceneKey` 同口径；规则只对群生效。 */
  readonly sceneId: string;
  readonly trigger: GroupRuleTrigger;
  readonly ladder: readonly GroupRuleStage[];
  readonly windowMs: number;
  readonly exempt: GroupRuleExempt;
  /** 人读摘要；进入终态后清空。 */
  readonly content: string;
  readonly contentHash: string;
  readonly status: GroupRuleStatus;
  readonly createdBy: string;
  readonly createdVia: GroupRuleCreatedVia;
  readonly approvedBy: string | null;
  readonly approvedAt: number | null;
  readonly approvedVia: GroupRuleApprovedVia | null;
  readonly submittedAt: number | null;
  readonly revision: number;
  /** 驳回 / 停用原因（截断）。 */
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
}

/** 规则可编辑的部分（决定 `content_hash`）。 */
export interface GroupRuleSpecInput {
  readonly trigger: string;
  readonly ladder: ReadonlyArray<{ readonly action: string; readonly durationSec?: number | null }>;
  readonly windowMs?: number | null;
  readonly exempt?: { readonly ownerAndAdmins?: boolean | null; readonly userIds?: readonly string[] | null } | null;
  readonly content: string;
}

export interface GroupRuleSpec {
  readonly trigger: GroupRuleTrigger;
  readonly ladder: readonly GroupRuleStage[];
  readonly windowMs: number;
  readonly exempt: GroupRuleExempt;
  readonly content: string;
}

export class GroupRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupRuleValidationError';
  }
}

export class GroupRuleNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`group rule ${id} not found`);
    this.id = id;
    this.name = 'GroupRuleNotFoundError';
  }
}

export class GroupRuleRevisionConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super(`group rule revision conflict: current revision is ${currentRevision}`);
    this.currentRevision = currentRevision;
    this.name = 'GroupRuleRevisionConflictError';
  }
}

export class GroupRuleStateError extends Error {
  readonly status: GroupRuleStatus;
  readonly action: string;
  constructor(status: GroupRuleStatus, action: string) {
    super(`group rule in status ${status} cannot ${action}`);
    this.status = status;
    this.action = action;
    this.name = 'GroupRuleStateError';
  }
}

/** 审批时看到的摘要与当前规则不一致（规则在出卡后被改过）。 */
export class GroupRuleHashMismatchError extends Error {
  readonly currentHash: string;
  constructor(currentHash: string) {
    super('group rule content hash mismatch: the rule changed after the approval card was shown');
    this.currentHash = currentHash;
    this.name = 'GroupRuleHashMismatchError';
  }
}

export class GroupRuleUnavailableError extends Error {
  constructor(message = 'group rule storage is unavailable') {
    super(message);
    this.name = 'GroupRuleUnavailableError';
  }
}

export function isGroupRuleTerminal(status: GroupRuleStatus): boolean {
  return GROUP_RULE_TERMINAL_STATUSES.includes(status);
}

const SCENE_ID_PATTERN = /^group:.+/u;

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** 校验并规范化规则内容；任何越界直接抛 {@link GroupRuleValidationError}。 */
export function normalizeGroupRuleSpec(input: GroupRuleSpecInput): GroupRuleSpec {
  if (!oneOf(GROUP_RULE_TRIGGERS, input.trigger)) {
    throw new GroupRuleValidationError(`trigger must be one of ${GROUP_RULE_TRIGGERS.join(', ')}`);
  }
  if (!Array.isArray(input.ladder) || input.ladder.length === 0 || input.ladder.length > MAX_GROUP_RULE_LADDER_STAGES) {
    throw new GroupRuleValidationError(`ladder must have 1-${MAX_GROUP_RULE_LADDER_STAGES} stages`);
  }
  const ladder = input.ladder.map((stage, index): GroupRuleStage => {
    if (!stage || !oneOf(GROUP_RULE_ACTIONS, stage.action)) {
      throw new GroupRuleValidationError(`ladder[${index}].action must be one of ${GROUP_RULE_ACTIONS.join(', ')}`);
    }
    if (stage.action !== 'mute') return Object.freeze({ action: stage.action });
    const sec = stage.durationSec;
    if (typeof sec !== 'number' || !Number.isSafeInteger(sec) || sec < MIN_GROUP_RULE_MUTE_SEC || sec > MAX_GROUP_RULE_MUTE_SEC) {
      throw new GroupRuleValidationError(`ladder[${index}].durationSec must be an integer in ${MIN_GROUP_RULE_MUTE_SEC}-${MAX_GROUP_RULE_MUTE_SEC}`);
    }
    return Object.freeze({ action: 'mute', durationSec: sec });
  });
  const windowMs = input.windowMs ?? DEFAULT_GROUP_RULE_WINDOW_MS;
  if (typeof windowMs !== 'number' || !Number.isSafeInteger(windowMs) || windowMs < MIN_GROUP_RULE_WINDOW_MS || windowMs > MAX_GROUP_RULE_WINDOW_MS) {
    throw new GroupRuleValidationError(`windowMs must be an integer in ${MIN_GROUP_RULE_WINDOW_MS}-${MAX_GROUP_RULE_WINDOW_MS}`);
  }
  const rawUsers = input.exempt?.userIds ?? [];
  if (!Array.isArray(rawUsers)) throw new GroupRuleValidationError('exempt.userIds must be an array');
  const userIds = [...new Set(rawUsers.map((id) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new GroupRuleValidationError('exempt.userIds must be non-empty strings');
    return id.trim();
  }))].sort();
  if (userIds.length > MAX_GROUP_RULE_EXEMPT_USERS) {
    throw new GroupRuleValidationError(`exempt.userIds must have at most ${MAX_GROUP_RULE_EXEMPT_USERS} entries`);
  }
  const ownerAndAdmins = input.exempt?.ownerAndAdmins ?? true;
  if (typeof ownerAndAdmins !== 'boolean') throw new GroupRuleValidationError('exempt.ownerAndAdmins must be a boolean');
  if (typeof input.content !== 'string' || !input.content.trim()) throw new GroupRuleValidationError('content must not be empty');
  const content = input.content.trim();
  if (Array.from(content).length > MAX_GROUP_RULE_CONTENT_CHARS) {
    throw new GroupRuleValidationError(`content must be at most ${MAX_GROUP_RULE_CONTENT_CHARS} characters`);
  }
  return Object.freeze({
    trigger: input.trigger,
    ladder: Object.freeze(ladder),
    windowMs,
    exempt: Object.freeze({ ownerAndAdmins, userIds: Object.freeze(userIds) }),
    content,
  });
}

/**
 * 规范化摘要：`platform + scene_id + trigger + ladder + window_ms + exempt + content` 的定序 JSON 的 sha256。
 * 改任何一个字段（含人读摘要的一个字）摘要都会变，审批随之作废。
 */
export function groupRuleContentHash(scope: Readonly<{ platform: string; sceneId: string }>, spec: GroupRuleSpec): string {
  const canonical = JSON.stringify([
    1,
    scope.platform,
    scope.sceneId,
    spec.trigger,
    spec.ladder.map((stage) => (stage.action === 'mute' ? [stage.action, stage.durationSec] : [stage.action])),
    spec.windowMs,
    [spec.exempt.ownerAndAdmins, [...spec.exempt.userIds].sort()],
    spec.content,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** 审批卡上展示的短码（摘要前 8 位）。 */
export function groupRuleHashShort(hash: string): string {
  return hash.slice(0, 8);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function ladderFromRow(value: unknown): readonly GroupRuleStage[] {
  const raw = parseJson(value);
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze(raw.flatMap((stage): GroupRuleStage[] => {
    if (!stage || !oneOf(GROUP_RULE_ACTIONS, (stage as { action?: unknown }).action)) return [];
    const action = (stage as { action: GroupRuleAction }).action;
    const sec = num((stage as { durationSec?: unknown }).durationSec);
    return [Object.freeze(action === 'mute' && sec != null ? { action, durationSec: sec } : { action })];
  }));
}

function exemptFromRow(value: unknown): GroupRuleExempt {
  const raw = parseJson(value) as { ownerAndAdmins?: unknown; userIds?: unknown } | null;
  if (!raw || typeof raw !== 'object') return DEFAULT_GROUP_RULE_EXEMPT;
  const userIds = Array.isArray(raw.userIds) ? raw.userIds.filter((id): id is string => typeof id === 'string') : [];
  return Object.freeze({ ownerAndAdmins: raw.ownerAndAdmins !== false, userIds: Object.freeze(userIds) });
}

export function groupRuleFromRow(row: Record<string, unknown>): GroupRuleRecord {
  return Object.freeze({
    id: String(row.id),
    platform: String(row.platform ?? ''),
    sceneId: String(row.scene_id ?? ''),
    // 码表外的旧值按最保守的 `advertising` 读出；执行器只认 active 行且会重新校验。
    trigger: oneOf(GROUP_RULE_TRIGGERS, row.rule_trigger) ? row.rule_trigger : 'advertising',
    ladder: ladderFromRow(row.ladder),
    windowMs: num(row.window_ms) ?? DEFAULT_GROUP_RULE_WINDOW_MS,
    exempt: exemptFromRow(row.exempt),
    content: String(row.content ?? ''),
    contentHash: String(row.content_hash ?? ''),
    // 无法识别的状态按 `disabled` 读出：宁可不执行，也不误执行。
    status: oneOf(GROUP_RULE_STATUSES, row.status) ? row.status : 'disabled',
    createdBy: String(row.created_by ?? ''),
    createdVia: oneOf(GROUP_RULE_CREATED_VIA, row.created_via) ? row.created_via : 'console',
    approvedBy: str(row.approved_by),
    approvedAt: num(row.approved_at),
    approvedVia: oneOf(GROUP_RULE_APPROVED_VIA, row.approved_via) ? row.approved_via : null,
    submittedAt: num(row.submitted_at),
    revision: num(row.revision) ?? 0,
    reason: str(row.reason),
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
    updatedBy: str(row.updated_by),
  });
}

export function groupRuleToRow(record: GroupRuleRecord): Record<string, unknown> {
  return {
    id: record.id,
    platform: record.platform,
    scene_id: record.sceneId,
    rule_trigger: record.trigger,
    ladder: JSON.stringify(record.ladder),
    window_ms: record.windowMs,
    exempt: JSON.stringify(record.exempt),
    content: record.content,
    content_hash: record.contentHash,
    status: record.status,
    created_by: record.createdBy,
    created_via: record.createdVia,
    approved_by: record.approvedBy,
    approved_at: record.approvedAt,
    approved_via: record.approvedVia,
    submitted_at: record.submittedAt,
    revision: record.revision,
    reason: record.reason,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    updated_by: record.updatedBy,
  };
}

/** 表模型的最小形状（与其他 `ai_*` 表同约定）；`delete` 用于保留期清理。 */
export interface GroupRuleModel {
  select(): { where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]> };
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
  delete?(): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

/** 审计写入口（`DecisionEventLog.record` 结构兼容）；写失败不得影响迁移。 */
export interface GroupRuleAuditSink {
  record(input: DecisionEventInput): unknown;
}

export interface GroupRuleTransition {
  readonly record: GroupRuleRecord;
  readonly from: GroupRuleStatus | null;
  readonly to: GroupRuleStatus;
  readonly reasonCode: DecisionReasonCode;
  readonly turnId: string;
  /** 批准时被替换（→ `disabled`）的旧规则。 */
  readonly superseded?: readonly GroupRuleRecord[];
}

export interface GroupRuleOptions {
  readonly now?: () => number;
  readonly approvalTtlMs?: number;
  readonly audit?: () => GroupRuleAuditSink | undefined;
  readonly instanceId?: string;
}

export interface CreateGroupRuleInput extends GroupRuleSpecInput {
  readonly platform: string;
  readonly sceneId: string;
  readonly createdBy: string;
  readonly createdVia: GroupRuleCreatedVia;
  readonly turnId?: string;
}

export interface GroupRuleMutationInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly actorId: string;
  readonly turnId?: string;
  /** 操作者身份：群内成员 / Console 用户记 `operator`（默认）。 */
  readonly actor?: DecisionActor;
}

export interface GroupRulePruneResult {
  readonly deleted: number;
}

function checkRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new GroupRuleValidationError('expectedRevision must be a non-negative integer');
  }
  return value;
}

function clipReason(value: string | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const chars = Array.from(value.trim());
  return chars.length <= MAX_GROUP_RULE_REASON_CHARS ? chars.join('') : chars.slice(0, MAX_GROUP_RULE_REASON_CHARS).join('');
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 规则存储与状态机（每个 Agent 进程一份）。写入串行化；接表后先落库再生效。 */
export class AiGroupRules {
  readonly #memory = new Map<string, GroupRuleRecord>();
  #model: GroupRuleModel | undefined;
  #writes: Promise<unknown> = Promise.resolve();
  readonly #now: () => number;
  readonly approvalTtlMs: number;
  readonly #audit: () => GroupRuleAuditSink | undefined;
  readonly #instanceId: string;

  constructor(options: GroupRuleOptions = {}) {
    this.#now = options.now ?? Date.now;
    const ttl = options.approvalTtlMs;
    this.approvalTtlMs = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? Math.trunc(ttl) : DEFAULT_GROUP_RULE_APPROVAL_TTL_MS;
    this.#audit = options.audit ?? (() => undefined);
    this.#instanceId = options.instanceId ?? '*';
  }

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  /** 接上 `ai_group_rules`；之后读写都以表为准。 */
  async upgradeToDatabase(model: GroupRuleModel): Promise<boolean> {
    this.#model = model;
    return true;
  }

  // ── 读取 ────────────────────────────────────────────────────────────────

  async get(id: string): Promise<GroupRuleRecord | null> {
    await this.expireDue();
    return this.#load(id);
  }

  /** 某会话的规则，按创建时间倒序；`status` / `trigger` 可选过滤。 */
  async list(input: Readonly<{ platform: string; sceneId: string; status?: GroupRuleStatus; trigger?: GroupRuleTrigger }>): Promise<readonly GroupRuleRecord[]> {
    await this.expireDue();
    const rows = await this.#query({
      platform: input.platform,
      scene_id: input.sceneId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.trigger ? { rule_trigger: input.trigger } : {}),
    });
    return Object.freeze(rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, MAX_GROUP_RULE_LIST));
  }

  /** 某会话某违规类型当前生效的规则（至多一条）。 */
  async getActive(input: Readonly<{ platform: string; sceneId: string; trigger: GroupRuleTrigger }>): Promise<GroupRuleRecord | null> {
    const rows = await this.#query({ platform: input.platform, scene_id: input.sceneId, rule_trigger: input.trigger, status: 'active' });
    // 理论上至多一条；万一并发留下多条，取最近批准的。
    return rows.sort((a, b) => (b.approvedAt ?? 0) - (a.approvedAt ?? 0))[0] ?? null;
  }

  // ── 迁移 ────────────────────────────────────────────────────────────────

  /** 起草（群内 / Console / 模型工具）：新建一行 `draft`。 */
  create(input: CreateGroupRuleInput): Promise<GroupRuleTransition> {
    return this.#serial(async () => {
      if (typeof input.platform !== 'string' || !input.platform.trim() || input.platform.length > 64) {
        throw new GroupRuleValidationError('platform is required');
      }
      if (typeof input.sceneId !== 'string' || !SCENE_ID_PATTERN.test(input.sceneId) || input.sceneId.length > 256) {
        throw new GroupRuleValidationError('sceneId must look like group:<id>');
      }
      if (typeof input.createdBy !== 'string' || !input.createdBy.trim()) throw new GroupRuleValidationError('createdBy is required');
      if (!oneOf(GROUP_RULE_CREATED_VIA, input.createdVia)) {
        throw new GroupRuleValidationError(`createdVia must be one of ${GROUP_RULE_CREATED_VIA.join(', ')}`);
      }
      const spec = normalizeGroupRuleSpec(input);
      const open = (await this.#query({ platform: input.platform, scene_id: input.sceneId }))
        .filter((rule) => rule.status === 'draft' || rule.status === 'pending');
      if (open.length >= MAX_OPEN_GROUP_RULES_PER_SCENE) {
        throw new GroupRuleValidationError(`at most ${MAX_OPEN_GROUP_RULES_PER_SCENE} draft/pending rules per group; disable some first`);
      }
      const now = this.#now();
      const record: GroupRuleRecord = Object.freeze({
        id: randomUUID(),
        platform: input.platform,
        sceneId: input.sceneId,
        ...spec,
        contentHash: groupRuleContentHash({ platform: input.platform, sceneId: input.sceneId }, spec),
        status: 'draft',
        createdBy: input.createdBy,
        createdVia: input.createdVia,
        approvedBy: null,
        approvedAt: null,
        approvedVia: null,
        submittedAt: null,
        revision: 1,
        reason: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.createdBy,
      });
      await this.#insert(record);
      const actor: DecisionActor = input.createdVia === 'model' ? 'model' : 'operator';
      return this.#transition(record, null, 'rule_drafted', 'allow', actor, input.createdBy, input.turnId);
    });
  }

  /** 改规则：`draft` / `pending` 回到 `draft`，重算摘要并清掉审批。`active` 与终态不可改。 */
  edit(input: GroupRuleMutationInput & { readonly spec: GroupRuleSpecInput }): Promise<GroupRuleTransition> {
    return this.#mutate(input, 'edit', (current) => {
      if (current.status !== 'draft' && current.status !== 'pending') throw new GroupRuleStateError(current.status, 'edit');
      const spec = normalizeGroupRuleSpec(input.spec);
      return {
        patch: { ...spec, contentHash: groupRuleContentHash(current, spec), status: 'draft', approvedBy: null, approvedAt: null, approvedVia: null, submittedAt: null },
        reasonCode: 'rule_drafted',
        outcome: 'allow',
        payload: { edited: true },
      };
    });
  }

  /** 提交审批：`draft` → `pending`。 */
  submit(input: GroupRuleMutationInput): Promise<GroupRuleTransition> {
    return this.#mutate(input, 'submit', (current) => {
      if (current.status !== 'draft') throw new GroupRuleStateError(current.status, 'submit');
      return { patch: { status: 'pending', submittedAt: this.#now() }, reasonCode: 'rule_submitted', outcome: 'defer' };
    });
  }

  /**
   * 批准：`pending` → `active`。`contentHash`（审批卡上看到的摘要）与当前不符 → 写 `rule_hash_mismatch` 并抛
   * {@link GroupRuleHashMismatchError}。同会话同 trigger 的旧 `active` 规则一并 → `disabled`（`rule_superseded`）。
   */
  approve(input: GroupRuleMutationInput & { readonly approvedVia: GroupRuleApprovedVia; readonly contentHash?: string }): Promise<GroupRuleTransition> {
    return this.#serial(async () => {
      if (!oneOf(GROUP_RULE_APPROVED_VIA, input.approvedVia)) {
        throw new GroupRuleValidationError(`approvedVia must be one of ${GROUP_RULE_APPROVED_VIA.join(', ')}`);
      }
      const current = await this.#prepare(input, 'approve');
      if (current.status !== 'pending') throw new GroupRuleStateError(current.status, 'approve');
      if (input.contentHash !== undefined && input.contentHash !== current.contentHash) {
        this.#transition(current, current.status, 'rule_hash_mismatch', 'deny', input.actor ?? 'operator', input.actorId, input.turnId, { expectedHash: input.contentHash });
        throw new GroupRuleHashMismatchError(current.contentHash);
      }
      const turnId = input.turnId ?? randomUUID();
      const previous = (await this.#query({ platform: current.platform, scene_id: current.sceneId, rule_trigger: current.trigger, status: 'active' }))
        .filter((rule) => rule.id !== current.id);
      const now = this.#now();
      const next = this.#next(current, { status: 'active', approvedBy: input.actorId, approvedAt: now, approvedVia: input.approvedVia }, input.actorId);
      await this.#update(next, current.revision);
      const superseded: GroupRuleRecord[] = [];
      for (const old of previous) {
        const disabled = this.#next(old, { status: 'disabled', content: '', reason: `superseded by ${current.id}` }, input.actorId);
        await this.#update(disabled, old.revision);
        superseded.push(disabled);
        this.#transition(disabled, old.status, 'rule_superseded', 'skip', 'policy', input.actorId, turnId, { supersededBy: current.id });
      }
      const transition = this.#transition(next, current.status, 'rule_approved', 'allow', input.actor ?? 'operator', input.actorId, turnId, {
        approvedVia: input.approvedVia,
        ladder: next.ladder,
        windowMs: next.windowMs,
        ...(superseded.length ? { superseded: superseded.map((rule) => rule.id) } : {}),
      });
      return Object.freeze({ ...transition, superseded: Object.freeze(superseded) });
    });
  }

  /** 驳回：`pending` → `rejected`（终态，清空人读摘要）。 */
  reject(input: GroupRuleMutationInput & { readonly reason?: string }): Promise<GroupRuleTransition> {
    return this.#mutate(input, 'reject', (current) => {
      if (current.status !== 'pending') throw new GroupRuleStateError(current.status, 'reject');
      return { patch: { status: 'rejected', content: '', reason: clipReason(input.reason) }, reasonCode: 'rule_rejected', outcome: 'deny' };
    });
  }

  /** 停用：`draft` / `pending` / `active` → `disabled`（终态，不需要审批）。 */
  disable(input: GroupRuleMutationInput & { readonly reason?: string }): Promise<GroupRuleTransition> {
    return this.#mutate(input, 'disable', (current) => {
      if (isGroupRuleTerminal(current.status)) throw new GroupRuleStateError(current.status, 'disable');
      return { patch: { status: 'disabled', content: '', reason: clipReason(input.reason) }, reasonCode: 'rule_disabled', outcome: 'skip' };
    });
  }

  /** 把超过审批时限的 `pending` 置为 `expired`（读取时顺带执行；宿主也可定时调用）。 */
  expireDue(): Promise<readonly GroupRuleTransition[]> {
    return this.#serial(async () => {
      const cutoff = this.#now() - this.approvalTtlMs;
      const pending = await this.#query({ status: 'pending' });
      const out: GroupRuleTransition[] = [];
      for (const current of pending) {
        if ((current.submittedAt ?? current.updatedAt) > cutoff) continue;
        out.push(await this.#expire(current));
      }
      return Object.freeze(out);
    });
  }

  /**
   * 保留期清理（启动时与每小时由宿主调用）：
   * - 终态行 `updated_at` 早于 now - retentionDays 天 → 删除；
   * - 每会话终态行超过 {@link MAX_TERMINAL_GROUP_RULES_PER_SCENE} 条 → 删最旧的；
   * - 超过审批时限的 `pending` 先置 `expired`。
   * `draft` / `pending` / `active` 不删。失败抛 {@link GroupRuleUnavailableError}，由调用方记日志。
   */
  prune(retentionDays: number = DEFAULT_GROUP_RULE_RETENTION_DAYS): Promise<GroupRulePruneResult> {
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
      return Promise.reject(new TypeError('group rule retentionDays must be a positive integer'));
    }
    return this.expireDue().then(() => this.#serial(async () => {
      const cutoff = this.#now() - retentionDays * DAY_MS;
      const terminal: GroupRuleRecord[] = [];
      for (const status of GROUP_RULE_TERMINAL_STATUSES) terminal.push(...await this.#query({ status }));
      const doomed = new Set<string>();
      const byScene = new Map<string, GroupRuleRecord[]>();
      for (const rule of terminal) {
        if (rule.updatedAt < cutoff) { doomed.add(rule.id); continue; }
        const key = `${rule.platform}\u0000${rule.sceneId}`;
        const list = byScene.get(key) ?? [];
        list.push(rule);
        byScene.set(key, list);
      }
      for (const list of byScene.values()) {
        if (list.length <= MAX_TERMINAL_GROUP_RULES_PER_SCENE) continue;
        list.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
        for (const rule of list.slice(MAX_TERMINAL_GROUP_RULES_PER_SCENE)) doomed.add(rule.id);
      }
      for (const id of doomed) await this.#remove(id);
      return Object.freeze({ deleted: doomed.size });
    }));
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#writes.then(run);
    this.#writes = next.catch(() => undefined);
    return next;
  }

  async #expire(current: GroupRuleRecord): Promise<GroupRuleTransition> {
    const expired = this.#next(current, { status: 'expired', content: '' }, null);
    await this.#update(expired, current.revision);
    return this.#transition(expired, current.status, 'rule_expired', 'skip', 'policy', null, undefined, { approvalTtlMs: this.approvalTtlMs });
  }

  /** 校验通用入参、读当前行、先过期、再比 revision。须在 `#serial` 内调用。 */
  async #prepare(input: GroupRuleMutationInput, action: string): Promise<GroupRuleRecord> {
    if (typeof input.id !== 'string' || !input.id) throw new GroupRuleValidationError('id is required');
    const expected = checkRevision(input.expectedRevision);
    if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new GroupRuleValidationError('actorId is required');
    const current = await this.#load(input.id);
    if (!current) throw new GroupRuleNotFoundError(input.id);
    // 先过期：超时的 pending 不能再被批准 / 驳回 / 修改。
    if (current.status === 'pending' && (current.submittedAt ?? current.updatedAt) <= this.#now() - this.approvalTtlMs) {
      await this.#expire(current);
      throw new GroupRuleStateError('expired', action);
    }
    if (current.revision !== expected) throw new GroupRuleRevisionConflictError(current.revision);
    return current;
  }

  #mutate(
    input: GroupRuleMutationInput,
    action: string,
    plan: (current: GroupRuleRecord) => {
      patch: Partial<GroupRuleRecord>;
      reasonCode: DecisionReasonCode;
      outcome: DecisionOutcome;
      payload?: Record<string, unknown>;
    },
  ): Promise<GroupRuleTransition> {
    return this.#serial(async () => {
      const current = await this.#prepare(input, action);
      const step = plan(current);
      const next = this.#next(current, step.patch, input.actorId);
      await this.#update(next, current.revision);
      return this.#transition(next, current.status, step.reasonCode, step.outcome, input.actor ?? 'operator', input.actorId, input.turnId, step.payload);
    });
  }

  #next(current: GroupRuleRecord, patch: Partial<GroupRuleRecord>, actorId: string | null): GroupRuleRecord {
    return Object.freeze({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: this.#now(),
      updatedBy: actorId ?? current.updatedBy,
    });
  }

  #transition(
    record: GroupRuleRecord,
    from: GroupRuleStatus | null,
    reasonCode: DecisionReasonCode,
    outcome: DecisionOutcome,
    actor: DecisionActor,
    actorId: string | null,
    turnId?: string,
    payload?: Record<string, unknown>,
  ): GroupRuleTransition {
    const id = turnId ?? randomUUID();
    let sink: GroupRuleAuditSink | undefined;
    try { sink = this.#audit(); } catch { sink = undefined; }
    if (sink) {
      try {
        const result = sink.record({
          turnId: id,
          instanceId: record.platform || this.#instanceId,
          platform: record.platform,
          sceneId: record.sceneId,
          kind: 'group_rule',
          outcome,
          reasonCode,
          ...(record.reason && isGroupRuleTerminal(record.status) ? { reasonDetail: record.reason } : {}),
          payload: {
            ruleId: record.id,
            from,
            to: record.status,
            trigger: record.trigger,
            revision: record.revision,
            contentHash: record.contentHash,
            createdVia: record.createdVia,
            ...(record.approvedBy ? { approvedBy: record.approvedBy, approvedVia: record.approvedVia } : {}),
            ...(payload ?? {}),
          },
          actor,
          ...(actorId ? { actorId } : {}),
        });
        if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
      } catch {
        // 审计不是门禁。
      }
    }
    return Object.freeze({ record, from, to: record.status, reasonCode, turnId: id });
  }

  #wrap(error: unknown): GroupRuleUnavailableError {
    return new GroupRuleUnavailableError(error instanceof Error ? error.message : String(error));
  }

  async #load(id: string): Promise<GroupRuleRecord | null> {
    const model = this.#model;
    if (!model) return this.#memory.get(id) ?? null;
    try {
      const rows = await model.select().where({ id });
      return rows[0] ? groupRuleFromRow(rows[0]) : null;
    } catch (error) {
      throw this.#wrap(error);
    }
  }

  async #query(condition: Record<string, unknown>): Promise<GroupRuleRecord[]> {
    const model = this.#model;
    if (!model) {
      return [...this.#memory.values()].filter((record) => {
        const row = groupRuleToRow(record);
        return Object.entries(condition).every(([key, value]) => row[key] === value);
      });
    }
    try {
      const rows = await model.select().where(condition);
      return rows.map(groupRuleFromRow);
    } catch (error) {
      throw this.#wrap(error);
    }
  }

  async #insert(record: GroupRuleRecord): Promise<void> {
    const model = this.#model;
    if (!model) {
      this.#memory.set(record.id, record);
      this.#evict();
      return;
    }
    try {
      await model.create(groupRuleToRow(record));
    } catch (error) {
      throw this.#wrap(error);
    }
  }

  async #update(record: GroupRuleRecord, expectedRevision: number): Promise<void> {
    const model = this.#model;
    if (!model) {
      const current = this.#memory.get(record.id);
      if (!current) throw new GroupRuleNotFoundError(record.id);
      if (current.revision !== expectedRevision) throw new GroupRuleRevisionConflictError(current.revision);
      this.#memory.set(record.id, record);
      return;
    }
    const { id, ...rest } = groupRuleToRow(record);
    try {
      await model.update(rest).where({ id, revision: expectedRevision });
    } catch (error) {
      throw this.#wrap(error);
    }
    // 乐观并发：读回确认本次写入生效（另一进程先写时 revision 不会是我们的值）。
    const stored = await this.#load(record.id);
    if (!stored) throw new GroupRuleNotFoundError(record.id);
    if (stored.revision !== record.revision || stored.status !== record.status || stored.contentHash !== record.contentHash) {
      throw new GroupRuleRevisionConflictError(stored.revision);
    }
  }

  async #remove(id: string): Promise<void> {
    const model = this.#model;
    if (!model) {
      this.#memory.delete(id);
      return;
    }
    if (!model.delete) return;
    try {
      await model.delete().where({ id });
    } catch (error) {
      throw this.#wrap(error);
    }
  }

  #evict(): void {
    if (this.#memory.size <= MAX_IN_MEMORY_GROUP_RULES) return;
    for (const [id, record] of this.#memory) {
      if (this.#memory.size <= MAX_IN_MEMORY_GROUP_RULES) break;
      if (isGroupRuleTerminal(record.status)) this.#memory.delete(id);
    }
  }
}
