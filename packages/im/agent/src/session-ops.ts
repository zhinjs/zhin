/**
 * 会话运营配置（ADR 0037 §1.1，第 1 期切片 A）：入群欢迎 / 退群记录。
 *
 * - 两级：**实例默认**（只提供默认模板与默认参数）+ **会话配置**（`platform + scene_id`，`scene_id` 与会话画像
 *   `sceneKey` 同口径，形如 `group:123`）。与 `ai_session_profiles` 的画像字段分开存放：画像是观测结果，这里是运营意图。
 * - **默认全关**：`welcome.enabled` / `leave.notify` 只能按会话打开，实例级不提供开关。
 * - 持久化：`ai_session_ops` 单行 JSON 文档 + revision（乐观并发，与控制面 `expectedRevision` 同约定）；先落库再生效。
 *   读库失败时**不发欢迎**（`welcome.enabled` 视为 false），退群照常只写审计；按间隔重试。
 * - 写入只经 Console（`session-ops-set`）；模型没有工具能读写这些配置。
 * - 群管协同（ADR 0037 §3，切片 E）：`ops.cooldownMs` 同样是「实例默认 + 会话覆盖」。硬闸在生成新审批卡之前
 *   按 `platform + scene_id + 工具本地名` 查冷却（见 `security/ops-cooldown.ts`）；冷却时长从这里读，
 *   冷却计时本身只在进程内存。与欢迎开关不同，冷却不受「读库失败」影响：读不出时仍用已知值（默认 60s），不会因此放开。
 * - 冷场（ADR 0037 §1.3，切片 C）：`coldField.enabled` 只能按会话打开（实例级只给 `threshold` / `durationMs` 默认值）；
 *   读库失败时与欢迎同口径视为关闭。计数器与临时 `mention_only` 覆盖只在进程内存（见控制面 `AiControlPlane`）。
 */
import { getLogger, formatCompact } from '@zhin.js/logger';

const logger = getLogger('agent');

export const AI_SESSION_OPS_TABLE = 'ai_session_ops';
/** 单行文档的主键。 */
export const AI_SESSION_OPS_ROW_ID = 'ops';
/** 读库失败后重试的最小间隔。 */
export const SESSION_OPS_RETRY_MS = 30_000;
/** 会话配置条数上限。 */
export const MAX_SESSION_OPS_ENTRIES = 1_000;

export const DEFAULT_WELCOME_TEMPLATE = '欢迎 {members} 加入{group}！';
export const DEFAULT_WELCOME_MERGE_WINDOW_MS = 60_000;
export const DEFAULT_WELCOME_MAX_PER_HOUR = 10;
/** 合并窗口上限：10 分钟。`0` 表示不合并（每个入群事件各发一条，仍受小时上限）。 */
export const MAX_WELCOME_MERGE_WINDOW_MS = 600_000;
export const MAX_WELCOME_PER_HOUR = 120;
export const MAX_WELCOME_TEMPLATE_CHARS = 500;
export const MAX_RULES_URL_CHARS = 300;
/** 群管冷却默认值（ADR 0037 §3 `ops.cooldownMs`）。 */
export const DEFAULT_OPS_COOLDOWN_MS = 60_000;
/** 群管冷却上限：24 小时。`0` 表示关闭冷却（只能由运营者在 Console 显式设置）。 */
export const MAX_OPS_COOLDOWN_MS = 86_400_000;
/** 冷场默认值（ADR 0037 §1.3「待 Fin 确认的默认值」）：连续 20 条、临时 `mention_only` 30 分钟。 */
export const DEFAULT_COLD_FIELD_THRESHOLD = 20;
export const DEFAULT_COLD_FIELD_DURATION_MS = 1_800_000;
export const MAX_COLD_FIELD_THRESHOLD = 1_000;
/** 临时 `mention_only` 时长范围：1 分钟 ~ 24 小时。 */
export const MIN_COLD_FIELD_DURATION_MS = 60_000;
export const MAX_COLD_FIELD_DURATION_MS = 86_400_000;

/** 模板变量白名单（ADR 0037 §1.1）。 */
export const WELCOME_TEMPLATE_VARS = ['members', 'nickname', 'group', 'rules_url'] as const;
export type WelcomeTemplateVar = typeof WELCOME_TEMPLATE_VARS[number];

/** 表结构：一行 JSON 文档 + revision（与 `ai_control_state` 同形）。 */
export const AI_SESSION_OPS_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  revision: { type: 'bigint' as const, nullable: false, default: 0 },
  state: { type: 'text' as const, default: '{}' },
  updated_at: { type: 'bigint' as const, nullable: true },
  updated_by: { type: 'text' as const, nullable: true },
};

export interface SessionWelcomeConfig {
  readonly enabled: boolean;
  readonly template: string;
  readonly mergeWindowMs: number;
  readonly maxPerHour: number;
  /** `{rules_url}` 的取值；空串时变量渲染为空。 */
  readonly rulesUrl: string;
}

export interface SessionLeaveConfig {
  /** 退群写 `member_lifecycle` / `member_leave_recorded`（只写审计）。 */
  readonly record: boolean;
  /** 退群在群里发消息；本切片只存配置，不发送。 */
  readonly notify: boolean;
}

/** 群管协同（ADR 0037 §3，切片 E）。 */
export interface SessionGroupOpsConfig {
  /**
   * 同一 `platform + scene_id + 动作`（工具本地名）在这段时间内只允许生成一张硬闸审批卡；
   * 计时从审批卡创建开始，不论批准与否。`0` = 不冷却。
   */
  readonly cooldownMs: number;
}

/** 冷场 → 会话临时 `mention_only`（ADR 0037 §1.3，切片 C）。 */
export interface SessionColdFieldConfig {
  /** 只能按会话打开；默认 `false`。 */
  readonly enabled: boolean;
  /** 连续多少条群消息未点名且旁听判定不参与后触发。 */
  readonly threshold: number;
  /** 临时 `mention_only` 持续时长（毫秒）。 */
  readonly durationMs: number;
}

export interface SessionOpsConfig {
  readonly welcome: SessionWelcomeConfig;
  readonly leave: SessionLeaveConfig;
  readonly ops: SessionGroupOpsConfig;
  readonly coldField: SessionColdFieldConfig;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type SessionWelcomePatch = Readonly<Partial<SessionWelcomeConfig>>;
export type SessionLeavePatch = Readonly<Partial<SessionLeaveConfig>>;
export type SessionGroupOpsPatch = Readonly<Partial<SessionGroupOpsConfig>>;
export type SessionColdFieldPatch = Readonly<Partial<SessionColdFieldConfig>>;
/** 实例默认只接受这些字段（不含开关）。 */
export type SessionOpsDefaultsPatch = Readonly<{
  welcome?: Readonly<Partial<Pick<SessionWelcomeConfig, 'template' | 'mergeWindowMs' | 'maxPerHour' | 'rulesUrl'>>>;
  leave?: Readonly<Partial<Pick<SessionLeaveConfig, 'record'>>>;
  ops?: SessionGroupOpsPatch;
  coldField?: Readonly<Partial<Pick<SessionColdFieldConfig, 'threshold' | 'durationMs'>>>;
}>;
export type SessionOpsPatch = Readonly<{
  welcome?: SessionWelcomePatch;
  leave?: SessionLeavePatch;
  ops?: SessionGroupOpsPatch;
  coldField?: SessionColdFieldPatch;
}>;

export interface SessionOpsEntry {
  readonly platform: string;
  /** `<scope>:<sceneId>`，只接受 `group` / `channel`。 */
  readonly sceneId: string;
  /** 只含显式设置过的字段；缺省回落实例默认。 */
  readonly overrides: SessionOpsPatch;
}

export interface SessionOpsSnapshot {
  readonly revision: number;
  /** 实例默认（已合并内置默认值）。 */
  readonly defaults: SessionOpsConfig;
  readonly sessions: readonly SessionOpsEntry[];
  readonly updatedAt: number | null;
  readonly updatedBy: string | null;
  readonly persistent: boolean;
  /** 持久化状态读不出来：欢迎一律不发，退群照常记审计。 */
  readonly available: boolean;
}

export const BUILTIN_SESSION_OPS_DEFAULTS: SessionOpsConfig = Object.freeze({
  welcome: Object.freeze({
    enabled: false,
    template: DEFAULT_WELCOME_TEMPLATE,
    mergeWindowMs: DEFAULT_WELCOME_MERGE_WINDOW_MS,
    maxPerHour: DEFAULT_WELCOME_MAX_PER_HOUR,
    rulesUrl: '',
  }),
  leave: Object.freeze({ record: true, notify: false }),
  ops: Object.freeze({ cooldownMs: DEFAULT_OPS_COOLDOWN_MS }),
  coldField: Object.freeze({ enabled: false, threshold: DEFAULT_COLD_FIELD_THRESHOLD, durationMs: DEFAULT_COLD_FIELD_DURATION_MS }),
});

export class SessionOpsRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`session ops revision conflict: current revision is ${currentRevision}`);
    this.name = 'SessionOpsRevisionConflictError';
  }
}

export class SessionOpsUnavailableError extends Error {
  constructor(message = 'session ops state is unavailable') {
    super(message);
    this.name = 'SessionOpsUnavailableError';
  }
}

export class SessionOpsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionOpsValidationError';
  }
}

// ============================================================================
// 模板渲染
// ============================================================================

export interface WelcomeMember {
  readonly id: string;
  readonly name?: string;
}

export type WelcomePart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'mention'; id: string; name?: string }>;

export interface WelcomeRenderInput {
  readonly members: readonly WelcomeMember[];
  /** 群名；缺省用群号。 */
  readonly group: string;
  readonly rulesUrl?: string;
}

export interface WelcomeRender {
  /** 出站段：`{members}` 渲染为逐个 @，其余为文本。 */
  readonly parts: readonly WelcomePart[];
  /** 纯文本（预览 / 审计摘要用）：@ 渲染为 `@昵称`。 */
  readonly text: string;
  /** 模板里出现的未知变量（原样保留，预览里标出）。 */
  readonly unknownVars: readonly string[];
}

const TEMPLATE_VAR = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const KNOWN_VARS: ReadonlySet<string> = new Set(WELCOME_TEMPLATE_VARS);

function memberName(member: WelcomeMember): string {
  return member.name?.trim() || member.id;
}

/** 模板中出现、但不在白名单里的变量名（去重，按出现顺序）。 */
export function unknownTemplateVars(template: string): string[] {
  const out: string[] = [];
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    const name = match[1]!;
    if (!KNOWN_VARS.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 渲染欢迎模板。只替换白名单变量：`{members}`（逐个 @）、`{nickname}`（昵称，多人用「、」连接）、
 * `{group}`、`{rules_url}`；未知变量原样保留，不报错。
 */
export function renderWelcomeTemplate(template: string, input: WelcomeRenderInput): WelcomeRender {
  const parts: WelcomePart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + text };
    else parts.push({ type: 'text', text });
  };
  let cursor = 0;
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    const index = match.index ?? 0;
    pushText(template.slice(cursor, index));
    cursor = index + match[0].length;
    switch (match[1]) {
      case 'members':
        input.members.forEach((member, i) => {
          if (i > 0) pushText(' ');
          parts.push({ type: 'mention', id: member.id, ...(member.name?.trim() ? { name: member.name.trim() } : {}) });
        });
        break;
      case 'nickname':
        pushText(input.members.map(memberName).join('、'));
        break;
      case 'group':
        pushText(input.group);
        break;
      case 'rules_url':
        pushText(input.rulesUrl ?? '');
        break;
      default:
        pushText(match[0]);
    }
  }
  pushText(template.slice(cursor));
  const text = parts.map((part) => (part.type === 'text' ? part.text : `@${part.name ?? part.id}`)).join('');
  return Object.freeze({ parts: Object.freeze(parts), text, unknownVars: Object.freeze(unknownTemplateVars(template)) });
}

// ============================================================================
// 文档解析与校验
// ============================================================================

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function entryKey(platform: string, sceneId: string): string {
  return `${platform}\u0000${sceneId}`;
}

const SCENE_ID_PATTERN = /^(group|channel):.+/u;

function checkInt(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new SessionOpsValidationError(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function checkText(value: unknown, label: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string') throw new SessionOpsValidationError(`${label} must be a string`);
  if (!allowEmpty && !value.trim()) throw new SessionOpsValidationError(`${label} must not be empty`);
  if (Array.from(value).length > max) throw new SessionOpsValidationError(`${label} must be at most ${max} characters`);
  return value;
}

function checkBool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new SessionOpsValidationError(`${label} must be a boolean`);
  return value;
}

const WELCOME_FIELDS = ['enabled', 'template', 'mergeWindowMs', 'maxPerHour', 'rulesUrl'] as const;
const LEAVE_FIELDS = ['record', 'notify'] as const;
const DEFAULT_WELCOME_FIELDS = ['template', 'mergeWindowMs', 'maxPerHour', 'rulesUrl'] as const;
const DEFAULT_LEAVE_FIELDS = ['record'] as const;
const OPS_FIELDS = ['cooldownMs'] as const;
const COLD_FIELD_FIELDS = ['enabled', 'threshold', 'durationMs'] as const;
const DEFAULT_COLD_FIELD_FIELDS = ['threshold', 'durationMs'] as const;

/**
 * 校验一段 welcome 补丁。`null` 表示「去掉会话覆盖、回落实例默认」，在 `allowNull` 时返回为 `undefined` 键标记。
 */
function validateWelcome(
  value: unknown,
  label: string,
  fields: readonly string[],
  allowNull: boolean,
): { set: Partial<Mutable<SessionWelcomeConfig>>; clear: string[] } {
  if (!isObject(value)) throw new SessionOpsValidationError(`${label} must be an object`);
  const set: Partial<Mutable<SessionWelcomeConfig>> = {};
  const clear: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!fields.includes(key)) throw new SessionOpsValidationError(`${label}: unknown field ${key}`);
    if (item === null && allowNull) { clear.push(key); continue; }
    switch (key) {
      case 'enabled': set.enabled = checkBool(item, `${label}.enabled`); break;
      case 'template': set.template = checkText(item, `${label}.template`, MAX_WELCOME_TEMPLATE_CHARS, false); break;
      case 'mergeWindowMs': set.mergeWindowMs = checkInt(item, `${label}.mergeWindowMs`, 0, MAX_WELCOME_MERGE_WINDOW_MS); break;
      case 'maxPerHour': set.maxPerHour = checkInt(item, `${label}.maxPerHour`, 1, MAX_WELCOME_PER_HOUR); break;
      case 'rulesUrl': set.rulesUrl = checkText(item, `${label}.rulesUrl`, MAX_RULES_URL_CHARS, true).trim(); break;
    }
  }
  return { set, clear };
}

function validateLeave(
  value: unknown,
  label: string,
  fields: readonly string[],
  allowNull: boolean,
): { set: Partial<Mutable<SessionLeaveConfig>>; clear: string[] } {
  if (!isObject(value)) throw new SessionOpsValidationError(`${label} must be an object`);
  const set: Partial<Mutable<SessionLeaveConfig>> = {};
  const clear: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!fields.includes(key)) throw new SessionOpsValidationError(`${label}: unknown field ${key}`);
    if (item === null && allowNull) { clear.push(key); continue; }
    if (key === 'record') set.record = checkBool(item, `${label}.record`);
    else set.notify = checkBool(item, `${label}.notify`);
  }
  return { set, clear };
}

function validateGroupOps(
  value: unknown,
  label: string,
  allowNull: boolean,
): { set: Partial<Mutable<SessionGroupOpsConfig>>; clear: string[] } {
  if (!isObject(value)) throw new SessionOpsValidationError(`${label} must be an object`);
  const set: Partial<Mutable<SessionGroupOpsConfig>> = {};
  const clear: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!(OPS_FIELDS as readonly string[]).includes(key)) throw new SessionOpsValidationError(`${label}: unknown field ${key}`);
    if (item === null && allowNull) { clear.push(key); continue; }
    set.cooldownMs = checkInt(item, `${label}.cooldownMs`, 0, MAX_OPS_COOLDOWN_MS);
  }
  return { set, clear };
}

function validateColdField(
  value: unknown,
  label: string,
  fields: readonly string[],
  allowNull: boolean,
): { set: Partial<Mutable<SessionColdFieldConfig>>; clear: string[] } {
  if (!isObject(value)) throw new SessionOpsValidationError(`${label} must be an object`);
  const set: Partial<Mutable<SessionColdFieldConfig>> = {};
  const clear: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!fields.includes(key)) throw new SessionOpsValidationError(`${label}: unknown field ${key}`);
    if (item === null && allowNull) { clear.push(key); continue; }
    switch (key) {
      case 'enabled': set.enabled = checkBool(item, `${label}.enabled`); break;
      case 'threshold': set.threshold = checkInt(item, `${label}.threshold`, 1, MAX_COLD_FIELD_THRESHOLD); break;
      case 'durationMs': set.durationMs = checkInt(item, `${label}.durationMs`, MIN_COLD_FIELD_DURATION_MS, MAX_COLD_FIELD_DURATION_MS); break;
    }
  }
  return { set, clear };
}

function compactPatch(patch: {
  welcome?: Record<string, unknown>;
  leave?: Record<string, unknown>;
  ops?: Record<string, unknown>;
  coldField?: Record<string, unknown>;
}): SessionOpsPatch {
  const out: { welcome?: SessionWelcomePatch; leave?: SessionLeavePatch; ops?: SessionGroupOpsPatch; coldField?: SessionColdFieldPatch } = {};
  if (patch.welcome && Object.keys(patch.welcome).length) out.welcome = Object.freeze({ ...patch.welcome }) as SessionWelcomePatch;
  if (patch.leave && Object.keys(patch.leave).length) out.leave = Object.freeze({ ...patch.leave }) as SessionLeavePatch;
  if (patch.ops && Object.keys(patch.ops).length) out.ops = Object.freeze({ ...patch.ops }) as SessionGroupOpsPatch;
  if (patch.coldField && Object.keys(patch.coldField).length) out.coldField = Object.freeze({ ...patch.coldField }) as SessionColdFieldPatch;
  return Object.freeze(out);
}

function hasOverrides(patch: SessionOpsPatch): boolean {
  return Boolean(patch.welcome || patch.leave || patch.ops || patch.coldField);
}

function mergeConfig(base: SessionOpsConfig, patch: SessionOpsPatch | undefined): SessionOpsConfig {
  return Object.freeze({
    welcome: Object.freeze({ ...base.welcome, ...(patch?.welcome ?? {}) }),
    leave: Object.freeze({ ...base.leave, ...(patch?.leave ?? {}) }),
    ops: Object.freeze({ ...base.ops, ...(patch?.ops ?? {}) }),
    coldField: Object.freeze({ ...base.coldField, ...(patch?.coldField ?? {}) }),
  });
}

interface SessionOpsDocument {
  defaults: SessionOpsConfig;
  sessions: Map<string, SessionOpsEntry>;
}

/** 解析持久化文档；结构损坏时抛错（调用方按「不可用」处理）。 */
export function parseSessionOpsDocument(text: unknown): { defaults: SessionOpsConfig; sessions: SessionOpsEntry[] } {
  const raw = typeof text === 'string' ? (text ? JSON.parse(text) : {}) : text ?? {};
  if (!isObject(raw)) throw new SessionOpsValidationError('session ops state must be an object');
  let defaults = BUILTIN_SESSION_OPS_DEFAULTS;
  if (raw.defaults !== undefined) {
    if (!isObject(raw.defaults)) throw new SessionOpsValidationError('defaults must be an object');
    const welcome = raw.defaults.welcome === undefined ? { set: {} } : validateWelcome(raw.defaults.welcome, 'defaults.welcome', DEFAULT_WELCOME_FIELDS, false);
    const leave = raw.defaults.leave === undefined ? { set: {} } : validateLeave(raw.defaults.leave, 'defaults.leave', DEFAULT_LEAVE_FIELDS, false);
    const ops = raw.defaults.ops === undefined ? { set: {} } : validateGroupOps(raw.defaults.ops, 'defaults.ops', false);
    const coldField = raw.defaults.coldField === undefined ? { set: {} } : validateColdField(raw.defaults.coldField, 'defaults.coldField', DEFAULT_COLD_FIELD_FIELDS, false);
    defaults = mergeConfig(BUILTIN_SESSION_OPS_DEFAULTS, compactPatch({ welcome: welcome.set, leave: leave.set, ops: ops.set, coldField: coldField.set }));
  }
  const sessions: SessionOpsEntry[] = [];
  if (raw.sessions !== undefined) {
    if (!Array.isArray(raw.sessions)) throw new SessionOpsValidationError('sessions must be an array');
    for (const item of raw.sessions) {
      if (!isObject(item) || typeof item.platform !== 'string' || !item.platform
        || typeof item.sceneId !== 'string' || !SCENE_ID_PATTERN.test(item.sceneId)) {
        throw new SessionOpsValidationError('session ops entry needs platform and a group/channel sceneId');
      }
      const overrides = isObject(item.overrides) ? item.overrides : {};
      const welcome = overrides.welcome === undefined ? { set: {} } : validateWelcome(overrides.welcome, 'overrides.welcome', WELCOME_FIELDS, false);
      const leave = overrides.leave === undefined ? { set: {} } : validateLeave(overrides.leave, 'overrides.leave', LEAVE_FIELDS, false);
      const ops = overrides.ops === undefined ? { set: {} } : validateGroupOps(overrides.ops, 'overrides.ops', false);
      const coldField = overrides.coldField === undefined ? { set: {} } : validateColdField(overrides.coldField, 'overrides.coldField', COLD_FIELD_FIELDS, false);
      const patch = compactPatch({ welcome: welcome.set, leave: leave.set, ops: ops.set, coldField: coldField.set });
      if (hasOverrides(patch)) sessions.push(Object.freeze({ platform: item.platform, sceneId: item.sceneId, overrides: patch }));
    }
  }
  return { defaults, sessions };
}

function diffDefaults(defaults: SessionOpsConfig): SessionOpsDefaultsPatch {
  const welcome: Record<string, unknown> = {};
  for (const key of DEFAULT_WELCOME_FIELDS) {
    if (defaults.welcome[key] !== BUILTIN_SESSION_OPS_DEFAULTS.welcome[key]) welcome[key] = defaults.welcome[key];
  }
  const leave: Record<string, unknown> = {};
  if (defaults.leave.record !== BUILTIN_SESSION_OPS_DEFAULTS.leave.record) leave.record = defaults.leave.record;
  const ops: Record<string, unknown> = {};
  if (defaults.ops.cooldownMs !== BUILTIN_SESSION_OPS_DEFAULTS.ops.cooldownMs) ops.cooldownMs = defaults.ops.cooldownMs;
  const coldField: Record<string, unknown> = {};
  for (const key of DEFAULT_COLD_FIELD_FIELDS) {
    if (defaults.coldField[key] !== BUILTIN_SESSION_OPS_DEFAULTS.coldField[key]) coldField[key] = defaults.coldField[key];
  }
  return compactPatch({ welcome, leave, ops, coldField }) as SessionOpsDefaultsPatch;
}

function serializeDocument(doc: SessionOpsDocument): string {
  return JSON.stringify({
    defaults: diffDefaults(doc.defaults),
    sessions: [...doc.sessions.values()].map((entry) => ({ platform: entry.platform, sceneId: entry.sceneId, overrides: entry.overrides })),
  });
}

// ============================================================================
// 存储
// ============================================================================

/** `ai_session_ops` 模型（`@zhin.js/database`）只用到这几个方法。 */
interface SessionOpsSelect extends PromiseLike<Record<string, unknown>[]> {
  where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]>;
}
export interface SessionOpsModel {
  select(): SessionOpsSelect;
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

export interface SessionOpsSetInput {
  readonly expectedRevision: number;
  /** 实例默认：只改给出的字段（不含开关）。 */
  readonly defaults?: unknown;
  /**
   * 会话配置：给出的字段覆盖该会话原值；字段写 `null` 去掉覆盖（回落实例默认）；`reset: true` 删除整个会话配置。
   */
  readonly sessions?: readonly unknown[];
  readonly actorId: string;
}

export interface SessionOpsChange {
  readonly scope: Readonly<{ level: 'instance' } | { level: 'session'; platform: string; sceneId: string }>;
  readonly before: SessionOpsConfig;
  readonly after: SessionOpsConfig;
}

export interface SessionOpsSetResult {
  readonly snapshot: SessionOpsSnapshot;
  readonly changes: readonly SessionOpsChange[];
}

function sameConfig(a: SessionOpsConfig, b: SessionOpsConfig): boolean {
  return WELCOME_FIELDS.every((key) => a.welcome[key] === b.welcome[key])
    && LEAVE_FIELDS.every((key) => a.leave[key] === b.leave[key])
    && OPS_FIELDS.every((key) => a.ops[key] === b.ops[key])
    && COLD_FIELD_FIELDS.every((key) => a.coldField[key] === b.coldField[key]);
}

/** 会话运营配置（每个 Agent 进程一份）。读取同步、只读内存；写入串行化并先落库再生效。 */
export class AiSessionOps {
  #doc: SessionOpsDocument = { defaults: BUILTIN_SESSION_OPS_DEFAULTS, sessions: new Map() };
  #revision = 0;
  #updatedAt: number | null = null;
  #updatedBy: string | null = null;
  #model: SessionOpsModel | undefined;
  #rowExists = false;
  #available = true;
  #lastLoadAttempt = 0;
  #loading: Promise<boolean> | undefined;
  #writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => number = Date.now) {}

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  get available(): boolean {
    return this.#available;
  }

  /** 接上 `ai_session_ops` 并读出持久化状态。读失败不抛错：标记不可用，稍后重试。 */
  async upgradeToDatabase(model: SessionOpsModel): Promise<boolean> {
    this.#model = model;
    this.#available = false;
    return this.reload();
  }

  reload(): Promise<boolean> {
    const model = this.#model;
    if (!model) {
      this.#available = true;
      return Promise.resolve(true);
    }
    if (this.#loading) return this.#loading;
    this.#lastLoadAttempt = this.now();
    this.#loading = (async () => {
      try {
        const rows = await model.select().where({ id: AI_SESSION_OPS_ROW_ID });
        const row = rows[0];
        if (row) {
          const parsed = parseSessionOpsDocument(row.state);
          this.#doc = { defaults: parsed.defaults, sessions: new Map(parsed.sessions.map((entry) => [entryKey(entry.platform, entry.sceneId), entry])) };
          this.#revision = Number(row.revision ?? 0) || 0;
          this.#updatedAt = row.updated_at == null ? null : Number(row.updated_at);
          this.#updatedBy = typeof row.updated_by === 'string' ? row.updated_by : null;
          this.#rowExists = true;
        } else {
          this.#rowExists = false;
        }
        this.#available = true;
        return true;
      } catch (error) {
        this.#available = false;
        logger.warn(formatCompact({ op: 'session_ops_load_failed', error: error instanceof Error ? error.message : String(error) }));
        return false;
      } finally {
        this.#loading = undefined;
      }
    })();
    return this.#loading;
  }

  #retryIfDue(): void {
    if (this.#available || !this.#model || this.#loading) return;
    if (this.now() - this.#lastLoadAttempt < SESSION_OPS_RETRY_MS) return;
    void this.reload();
  }

  snapshot(): SessionOpsSnapshot {
    this.#retryIfDue();
    return Object.freeze({
      revision: this.#revision,
      defaults: this.#doc.defaults,
      sessions: Object.freeze([...this.#doc.sessions.values()]
        .sort((a, b) => a.platform.localeCompare(b.platform) || a.sceneId.localeCompare(b.sceneId))),
      updatedAt: this.#updatedAt,
      updatedBy: this.#updatedBy,
      persistent: this.persistent,
      available: this.#available,
    });
  }

  /**
   * 该会话生效的配置（实例默认 + 会话覆盖）。`sceneId` 为 `<scope>:<sceneId>`。
   * 状态不可用时 `welcome.enabled` / `coldField.enabled` 一律为 false（不发欢迎、不进冷场），其余按已知值。
   */
  resolve(platform: string, sceneId: string): SessionOpsConfig {
    this.#retryIfDue();
    const merged = mergeConfig(this.#doc.defaults, this.#doc.sessions.get(entryKey(platform, sceneId))?.overrides);
    if (this.#available) return merged;
    return Object.freeze({
      welcome: Object.freeze({ ...merged.welcome, enabled: false }),
      leave: merged.leave,
      ops: merged.ops,
      coldField: Object.freeze({ ...merged.coldField, enabled: false }),
    });
  }

  /** 运营者写入（只经 Console）。`expectedRevision` 不符抛 {@link SessionOpsRevisionConflictError}，不覆盖。 */
  set(input: SessionOpsSetInput): Promise<SessionOpsSetResult> {
    const run = this.#writes.then(() => this.#apply(input));
    this.#writes = run.catch(() => undefined);
    return run;
  }

  async #apply(input: SessionOpsSetInput): Promise<SessionOpsSetResult> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new SessionOpsValidationError('expectedRevision must be a non-negative integer');
    }
    if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new SessionOpsValidationError('actorId is required');
    let defaultsPatch: SessionOpsPatch | undefined;
    if (input.defaults !== undefined) {
      if (!isObject(input.defaults)) throw new SessionOpsValidationError('defaults must be an object');
      for (const key of Object.keys(input.defaults)) {
        if (key !== 'welcome' && key !== 'leave' && key !== 'ops' && key !== 'coldField') throw new SessionOpsValidationError(`defaults: unknown field ${key}`);
      }
      const welcome = input.defaults.welcome === undefined ? { set: {} } : validateWelcome(input.defaults.welcome, 'defaults.welcome', DEFAULT_WELCOME_FIELDS, false);
      const leave = input.defaults.leave === undefined ? { set: {} } : validateLeave(input.defaults.leave, 'defaults.leave', DEFAULT_LEAVE_FIELDS, false);
      const ops = input.defaults.ops === undefined ? { set: {} } : validateGroupOps(input.defaults.ops, 'defaults.ops', false);
      const coldField = input.defaults.coldField === undefined ? { set: {} } : validateColdField(input.defaults.coldField, 'defaults.coldField', DEFAULT_COLD_FIELD_FIELDS, false);
      defaultsPatch = compactPatch({ welcome: welcome.set, leave: leave.set, ops: ops.set, coldField: coldField.set });
    }
    const sessionPatches = (input.sessions ?? []).map((entry, index) => {
      const label = `sessions[${index}]`;
      if (!isObject(entry)) throw new SessionOpsValidationError(`${label} must be an object`);
      for (const key of Object.keys(entry)) {
        if (!['platform', 'sceneId', 'welcome', 'leave', 'ops', 'coldField', 'reset'].includes(key)) throw new SessionOpsValidationError(`${label}: unknown field ${key}`);
      }
      if (typeof entry.platform !== 'string' || !entry.platform.trim() || entry.platform.length > 64) {
        throw new SessionOpsValidationError(`${label}.platform is required`);
      }
      if (typeof entry.sceneId !== 'string' || !SCENE_ID_PATTERN.test(entry.sceneId) || entry.sceneId.length > 256) {
        throw new SessionOpsValidationError(`${label}.sceneId must look like group:<id> or channel:<id>`);
      }
      const reset = entry.reset === undefined ? false : checkBool(entry.reset, `${label}.reset`);
      const welcome = entry.welcome === undefined ? { set: {}, clear: [] } : validateWelcome(entry.welcome, `${label}.welcome`, WELCOME_FIELDS, true);
      const leave = entry.leave === undefined ? { set: {}, clear: [] } : validateLeave(entry.leave, `${label}.leave`, LEAVE_FIELDS, true);
      const ops = entry.ops === undefined ? { set: {}, clear: [] } : validateGroupOps(entry.ops, `${label}.ops`, true);
      const coldField = entry.coldField === undefined ? { set: {}, clear: [] } : validateColdField(entry.coldField, `${label}.coldField`, COLD_FIELD_FIELDS, true);
      return { platform: entry.platform, sceneId: entry.sceneId, reset, welcome, leave, ops, coldField };
    });
    if (!this.#available) {
      if (!(await this.reload())) throw new SessionOpsUnavailableError();
    }
    if (input.expectedRevision !== this.#revision) throw new SessionOpsRevisionConflictError(this.#revision);

    const changes: SessionOpsChange[] = [];
    const nextDefaults = defaultsPatch ? mergeConfig(this.#doc.defaults, defaultsPatch) : this.#doc.defaults;
    // 记录每个会话在默认值变化前后的生效值，以便只报告实际变化。
    const resolveWith = (defaults: SessionOpsConfig, sessions: Map<string, SessionOpsEntry>, key: string) =>
      mergeConfig(defaults, sessions.get(key)?.overrides);
    if (!sameConfig(nextDefaults, this.#doc.defaults)) {
      changes.push({ scope: { level: 'instance' }, before: this.#doc.defaults, after: nextDefaults });
    }
    const nextSessions = new Map(this.#doc.sessions);
    for (const patch of sessionPatches) {
      const key = entryKey(patch.platform, patch.sceneId);
      const before = resolveWith(this.#doc.defaults, this.#doc.sessions, key);
      if (patch.reset) {
        nextSessions.delete(key);
      } else {
        const current = nextSessions.get(key)?.overrides ?? {};
        const welcome: Record<string, unknown> = { ...(current.welcome ?? {}), ...patch.welcome.set };
        for (const name of patch.welcome.clear) delete welcome[name];
        const leave: Record<string, unknown> = { ...(current.leave ?? {}), ...patch.leave.set };
        for (const name of patch.leave.clear) delete leave[name];
        const ops: Record<string, unknown> = { ...(current.ops ?? {}), ...patch.ops.set };
        for (const name of patch.ops.clear) delete ops[name];
        const coldField: Record<string, unknown> = { ...(current.coldField ?? {}), ...patch.coldField.set };
        for (const name of patch.coldField.clear) delete coldField[name];
        const overrides = compactPatch({ welcome, leave, ops, coldField });
        if (hasOverrides(overrides)) {
          nextSessions.set(key, Object.freeze({ platform: patch.platform, sceneId: patch.sceneId, overrides }));
        } else {
          nextSessions.delete(key);
        }
      }
      const after = resolveWith(nextDefaults, nextSessions, key);
      if (!sameConfig(before, after)) changes.push({ scope: { level: 'session', platform: patch.platform, sceneId: patch.sceneId }, before, after });
    }
    if (nextSessions.size > MAX_SESSION_OPS_ENTRIES) {
      throw new SessionOpsValidationError(`at most ${MAX_SESSION_OPS_ENTRIES} session entries`);
    }
    const nextDoc: SessionOpsDocument = { defaults: nextDefaults, sessions: nextSessions };
    const revision = this.#revision + 1;
    const updatedAt = this.now();
    const model = this.#model;
    if (model) {
      const row = { revision, state: serializeDocument(nextDoc), updated_at: updatedAt, updated_by: input.actorId };
      if (this.#rowExists) {
        await model.update(row).where({ id: AI_SESSION_OPS_ROW_ID, revision: this.#revision });
      } else {
        await model.create({ id: AI_SESSION_OPS_ROW_ID, ...row });
        this.#rowExists = true;
      }
    }
    this.#doc = nextDoc;
    this.#revision = revision;
    this.#updatedAt = updatedAt;
    this.#updatedBy = input.actorId;
    this.#available = true;
    return { snapshot: this.snapshot(), changes };
  }
}
