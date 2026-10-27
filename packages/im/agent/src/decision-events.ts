/**
 * 决策审计表 `ai_decision_events`（ADR 0036 切片 A）。
 *
 * append-only：每一次「进不进模型 / 说不说话 / 调不调工具 / 开关变了」写一行，只增不改。
 * 本文件只定义表结构、枚举、码表与序列化（截断 / 脱敏 / 校验）；写路径埋点在切片 B。
 *
 * - `scene_id` 与会话画像 `sceneKey` 同口径：`<scope>:<sceneId>`（见 `sceneKeyOf`）；
 *   和 `platform` 一起对齐 `ai_session_profiles` 的 `platform + scene_key`。
 * - `reason_code` 只能取 {@link DECISION_REASON_CODES} 中的值；未知原因统一 `unknown`，
 *   原始字符串进 `reason_detail`，禁止临时拼字符串当码。已有码只能弃用，不能删除或改义。
 * - `payload` 不得含密钥、Cookie、token、完整提示词：写入前经 {@link redactDecisionPayload}。
 */

import { randomUUID } from 'node:crypto';
import type { SpeakBlockReason } from './session-profile.js';

export const AI_DECISION_EVENTS_TABLE = 'ai_decision_events';
/** 默认保留天数（`ai.audit.retentionDays`）；清理任务不在切片 A。 */
export const DEFAULT_DECISION_AUDIT_RETENTION_DAYS = 14;
/** `reason_detail` 上限（字符）。 */
export const MAX_REASON_DETAIL_CHARS = 200;
/** `payload` 序列化后的上限（字符）；超出时只保留截断标记。 */
export const MAX_DECISION_PAYLOAD_CHARS = 4_000;

export const DECISION_EVENT_KINDS = [
  'inbound_wake',
  'speak_gate',
  'control_gate',
  'ambient_decision',
  'model_skip',
  'model_run',
  'tool_call',
  'tool_hard_gate',
  'tool_approval',
  'outbound',
  'config_change',
  'control_change',
] as const;
export type DecisionEventKind = typeof DECISION_EVENT_KINDS[number];

export const DECISION_OUTCOMES = ['allow', 'deny', 'skip', 'defer', 'error'] as const;
export type DecisionOutcome = typeof DECISION_OUTCOMES[number];

export const DECISION_ACTORS = ['system', 'model', 'operator', 'policy'] as const;
export type DecisionActor = typeof DECISION_ACTORS[number];

/**
 * 稳定机器码（蛇形小写）。只能追加；不再使用的码移入 {@link DEPRECATED_DECISION_REASON_CODES}，
 * 仍保留在本列表中以便解析历史行。
 */
export const DECISION_REASON_CODES = [
  'unknown',
  // 会话画像 session-gate（#995）
  'cannot_speak_muted',
  'cannot_speak_muted_all',
  'cannot_speak_restricted',
  // 控制面四开关
  'control_emergency_stop',
  'control_muted_instance',
  'control_muted_session',
  'control_read_only',
  'control_mention_only',
  // 旁听 / scene event（#997）
  'ambient_not_engaged',
  'scene_event_nothing_new',
  // 危险工具
  'tool_dangerous_no_approval',
  'tool_approval_timeout',
  'tool_approval_denied',
] as const;
export type DecisionReasonCode = typeof DECISION_REASON_CODES[number];

/** 已弃用但仍可解析的码；弃用不删除。 */
export const DEPRECATED_DECISION_REASON_CODES: ReadonlySet<DecisionReasonCode> = new Set<DecisionReasonCode>();

const KIND_SET: ReadonlySet<string> = new Set(DECISION_EVENT_KINDS);
const OUTCOME_SET: ReadonlySet<string> = new Set(DECISION_OUTCOMES);
const ACTOR_SET: ReadonlySet<string> = new Set(DECISION_ACTORS);
const REASON_SET: ReadonlySet<string> = new Set(DECISION_REASON_CODES);

export function isDecisionEventKind(value: unknown): value is DecisionEventKind {
  return typeof value === 'string' && KIND_SET.has(value);
}
export function isDecisionOutcome(value: unknown): value is DecisionOutcome {
  return typeof value === 'string' && OUTCOME_SET.has(value);
}
export function isDecisionActor(value: unknown): value is DecisionActor {
  return typeof value === 'string' && ACTOR_SET.has(value);
}
export function isDecisionReasonCode(value: unknown): value is DecisionReasonCode {
  return typeof value === 'string' && REASON_SET.has(value);
}

/** 表结构：字段与 ADR 0036 §1 一一对应。 */
export const AI_DECISION_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  ts: { type: 'bigint' as const, nullable: false },
  turn_id: { type: 'text' as const, nullable: false },
  instance_id: { type: 'text' as const, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  user_id: { type: 'text' as const, nullable: true },
  kind: { type: 'text' as const, nullable: false },
  outcome: { type: 'text' as const, nullable: false },
  reason_code: { type: 'text' as const, nullable: false },
  reason_detail: { type: 'text' as const, nullable: true },
  payload: { type: 'text' as const, default: '{}' },
  actor: { type: 'text' as const, nullable: false },
  actor_id: { type: 'text' as const, nullable: true },
};

export type DecisionPayload = Record<string, unknown>;

export interface DecisionEventRecord {
  id: string;
  ts: number;
  turnId: string;
  instanceId: string;
  platform: string;
  sceneId: string;
  userId: string | null;
  kind: DecisionEventKind;
  outcome: DecisionOutcome;
  reasonCode: DecisionReasonCode;
  reasonDetail: string | null;
  payload: DecisionPayload;
  actor: DecisionActor;
  actorId: string | null;
}

export interface DecisionEventRow {
  [key: string]: unknown;
  id: string;
  ts: number;
  turn_id: string;
  instance_id: string;
  platform: string;
  scene_id: string;
  user_id: string | null;
  kind: string;
  outcome: string;
  reason_code: string;
  reason_detail: string | null;
  payload: string;
  actor: string;
  actor_id: string | null;
}

export interface DecisionEventInput {
  id?: string;
  ts?: number;
  turnId: string;
  instanceId: string;
  platform: string;
  sceneId: string;
  userId?: string | null;
  kind: DecisionEventKind;
  outcome: DecisionOutcome;
  /** 不在码表中的值会落为 `unknown`，原值并入 `reasonDetail`。 */
  reasonCode: string;
  reasonDetail?: string | null;
  payload?: DecisionPayload;
  actor: DecisionActor;
  actorId?: string | null;
}

export class DecisionEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionEventValidationError';
  }
}

/** 截断人读补充；空串视为无。 */
export function truncateReasonDetail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_REASON_DETAIL_CHARS
    ? `${chars.slice(0, MAX_REASON_DETAIL_CHARS - 1).join('')}…`
    : text;
}

/** 规范化 reason_code：码表外一律 `unknown`，原值返回给调用方写入 detail。 */
export function normalizeReasonCode(value: string): { code: DecisionReasonCode; unknownRaw: string | null } {
  if (isDecisionReasonCode(value)) return { code: value, unknownRaw: null };
  return { code: 'unknown', unknownRaw: value };
}

/** #995 `SpeakBlockReason` → 稳定码；`restricted:` 后缀进 detail。 */
export function speakBlockReasonCode(reason: SpeakBlockReason): { code: DecisionReasonCode; detail: string | null } {
  if (reason === 'muted') return { code: 'cannot_speak_muted', detail: null };
  if (reason === 'muted_all') return { code: 'cannot_speak_muted_all', detail: null };
  const suffix = reason.slice('restricted:'.length);
  return { code: 'cannot_speak_restricted', detail: suffix || null };
}

// ============================================================================
// payload 脱敏
// ============================================================================

const REDACTED = '[redacted]';
const MAX_DEPTH = 5;
const MAX_ENTRIES = 50;
const MAX_STRING_CHARS = 500;

/** 键名（去掉 `-` / `_`、小写后）命中即整值替换。 */
const SECRET_KEYS = new Set([
  'password', 'passwd', 'pwd', 'secret', 'clientsecret', 'token', 'accesstoken', 'refreshtoken',
  'idtoken', 'apikey', 'privatekey', 'authorization', 'auth', 'cookie', 'cookies', 'setcookie',
  'session', 'sessionid', 'sessdata', 'bilijct', 'credential', 'credentials',
]);
/** 提示词类键名：完整提示词不得入审计。 */
const PROMPT_KEYS = new Set([
  'prompt', 'systemprompt', 'system', 'messages', 'instructions', 'rawprompt', 'fullprompt',
]);

const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat|xox[abpr])_[A-Za-z0-9_]{8,}/g, REDACTED],
  [/\b(?:SESSDATA|bili_jct|cookie)\s*[=:]\s*[^;\s]+/gi, REDACTED],
];

function normalizeKey(key: string): string {
  return key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
}

function redactString(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text.length > MAX_STRING_CHARS ? `${text.slice(0, MAX_STRING_CHARS)}… [truncated]` : text;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
      const normalized = normalizeKey(key);
      if (SECRET_KEYS.has(normalized)) out[key] = REDACTED;
      else if (PROMPT_KEYS.has(normalized)) out[key] = '[omitted]';
      else out[key] = redactValue(item, depth + 1);
    }
    return out;
  }
  return null;
}

/** 脱敏并裁剪 payload：密钥类键替换为 `[redacted]`，提示词类键替换为 `[omitted]`，值内令牌打码。 */
export function redactDecisionPayload(payload: DecisionPayload | null | undefined): DecisionPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return redactValue(payload, 0) as DecisionPayload;
}

function serializePayload(payload: DecisionPayload): string {
  const text = JSON.stringify(payload);
  if (text.length <= MAX_DECISION_PAYLOAD_CHARS) return text;
  return JSON.stringify({ truncated: true, chars: text.length });
}

function parsePayload(value: unknown): DecisionPayload {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DecisionPayload;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function requireText(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DecisionEventValidationError(`ai_decision_events.${name} is required`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

// ============================================================================
// 构造与序列化
// ============================================================================

/**
 * 由调用方输入构造一条审计记录：补 id / ts，校验枚举，规范化 reason_code，截断 detail，脱敏 payload。
 * 校验失败抛 {@link DecisionEventValidationError}；写路径（切片 B）负责捕获并只记日志，不阻断回合。
 */
export function createDecisionEvent(input: DecisionEventInput, now: number = Date.now()): DecisionEventRecord {
  if (!isDecisionEventKind(input.kind)) throw new DecisionEventValidationError(`unknown kind: ${String(input.kind)}`);
  if (!isDecisionOutcome(input.outcome)) throw new DecisionEventValidationError(`unknown outcome: ${String(input.outcome)}`);
  if (!isDecisionActor(input.actor)) throw new DecisionEventValidationError(`unknown actor: ${String(input.actor)}`);
  const actorId = optionalText(input.actorId);
  if (input.actor === 'operator' && !actorId) {
    throw new DecisionEventValidationError('actor_id is required when actor=operator');
  }
  const { code, unknownRaw } = normalizeReasonCode(input.reasonCode);
  const detailParts = [unknownRaw ? `reason_code=${unknownRaw}` : null, input.reasonDetail ?? null].filter(Boolean);
  const ts = input.ts ?? now;
  if (!Number.isFinite(ts) || ts < 0) throw new DecisionEventValidationError('ts must be a non-negative number');
  return {
    id: input.id ?? randomUUID(),
    ts: Math.trunc(ts),
    turnId: requireText('turn_id', input.turnId),
    instanceId: requireText('instance_id', input.instanceId),
    platform: requireText('platform', input.platform),
    sceneId: requireText('scene_id', input.sceneId),
    userId: optionalText(input.userId),
    kind: input.kind,
    outcome: input.outcome,
    reasonCode: code,
    reasonDetail: truncateReasonDetail(detailParts.join('; ')),
    payload: redactDecisionPayload(input.payload),
    actor: input.actor,
    actorId,
  };
}

export function decisionEventToRow(record: DecisionEventRecord): DecisionEventRow {
  return {
    id: record.id,
    ts: record.ts,
    turn_id: record.turnId,
    instance_id: record.instanceId,
    platform: record.platform,
    scene_id: record.sceneId,
    user_id: record.userId,
    kind: record.kind,
    outcome: record.outcome,
    reason_code: record.reasonCode,
    reason_detail: truncateReasonDetail(record.reasonDetail),
    payload: serializePayload(redactDecisionPayload(record.payload)),
    actor: record.actor,
    actor_id: record.actorId,
  };
}

/**
 * 读出一行。历史行里已不在当前枚举中的值不丢行：kind / outcome / actor 原样保留为字符串，
 * reason_code 落 `unknown`；调用方按需过滤。
 */
export function decisionEventFromRow(row: Record<string, unknown>): DecisionEventRecord {
  const { code, unknownRaw } = normalizeReasonCode(String(row.reason_code ?? ''));
  const detail = optionalText(row.reason_detail);
  return {
    id: String(row.id ?? ''),
    ts: Number(row.ts ?? 0),
    turnId: String(row.turn_id ?? ''),
    instanceId: String(row.instance_id ?? ''),
    platform: String(row.platform ?? ''),
    sceneId: String(row.scene_id ?? ''),
    userId: optionalText(row.user_id),
    kind: String(row.kind ?? '') as DecisionEventKind,
    outcome: String(row.outcome ?? '') as DecisionOutcome,
    reasonCode: code,
    reasonDetail: unknownRaw && !detail ? truncateReasonDetail(`reason_code=${unknownRaw}`) : detail,
    payload: parsePayload(row.payload),
    actor: String(row.actor ?? '') as DecisionActor,
    actorId: optionalText(row.actor_id),
  };
}

/** 导出用：与表结构同名字段（snake_case），payload 为对象。 */
export function decisionEventToExport(record: DecisionEventRecord): Omit<DecisionEventRow, 'payload'> & { payload: DecisionPayload } {
  const row = decisionEventToRow(record);
  return { ...row, payload: parsePayload(row.payload) };
}
