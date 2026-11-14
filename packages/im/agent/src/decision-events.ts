/**
 * 决策审计表 `ai_decision_events`（ADR 0036 切片 A）。
 *
 * append-only：每一次「进不进模型 / 说不说话 / 调不调工具 / 开关变了」写一行，只增不改。
 * 本文件只定义表结构、枚举、码表与序列化（截断 / 脱敏 / 校验）；写入见 `decision-event-log.ts`（切片 B）。
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

/**
 * Payload key on a row written only as the consequence of another decision row in the same turn
 * (#1250): a gate (`ambient_decision` / `control_gate` / `speak_gate`) that stops a turn also writes a
 * `model_skip` with `payload.parent` set to the gate's kind. Readers that count `model_skip` are
 * unaffected; a replay that shows one row per decision folds rows carrying `parent` into that parent.
 */
export const DECISION_PARENT_KEY = 'parent';

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
  // ADR 0037 第 1 期（切片 A）：入群 / 退群事件与欢迎是否发送
  'member_lifecycle',
  // ADR 0037 第 1 期（切片 B）：公告状态迁移（起草、提交、批准、驳回、过期、发送、失败、重发）
  'announcement',
  // ADR 0037 第 1 期（切片 E）：群管动作命中或通过冷却（`ops.cooldownMs`）
  'ops_cooldown',
  // ADR 0037 第 1 期（切片 D）：会话日程的创建、修改、取消与到点触发结果
  'schedule',
  // ADR 0039 切片 A：动态群管规则状态迁移（起草、提交、批准、驳回、过期、停用、被新规则替换）
  'group_rule',
  // ADR 0039：一次规则命中的判定与执行结果（执行器见切片 C）
  'rule_enforcement',
  // ADR 0040 切片 A：受控自我进化——变更的每次状态迁移
  'self_change',
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
  // 写路径（切片 B）：入站 / 旁听 / scene event / 模型 / 出站
  'inbound_addressed',
  'ambient_engaged',
  'scene_event_high_priority',
  'scene_event_rate_limited',
  'scene_event_wake_failed',
  'model_completed',
  'model_failed',
  'model_cancelled',
  'model_superseded',
  'outbound_sent',
  'outbound_suppressed',
  'outbound_failed',
  // 危险工具硬闸（切片 E）
  'tool_approval_requested',
  'tool_approval_approved',
  'tool_funds_disabled',
  'host_path_protected',
  'tool_hard_gate_latched',
  'tool_safe_allowed',
  // ADR 0037 切片 A：入群欢迎 / 退群记录
  'welcome_sent',
  'welcome_merged',
  'welcome_rate_limited',
  'welcome_disabled',
  'member_leave_recorded',
  // ADR 0037 切片 B：公告 草稿 → 审批 → 发送
  'announcement_drafted',
  'announcement_submitted',
  'announcement_approved',
  'announcement_rejected',
  'announcement_expired',
  'announcement_sent',
  'announcement_send_failed',
  'announcement_resend',
  'announcement_hash_mismatch',
  // ADR 0037 切片 E：群管冷却（同一 platform + scene_id + 工具本地名，在硬闸之前判定）
  'ops_cooldown_hit',
  'ops_cooldown_passed',
  // ADR 0037 切片 C：冷场 → 会话临时 mention_only（复用 control_change / control_gate，不新增 kind）
  'cold_field_mention_only_on',
  'cold_field_mention_only_expired',
  'cold_field_mention_only_cleared',
  // ADR 0037 切片 D：会话日程（`ai_session_events`）与到点唤醒
  'schedule_event_created',
  'schedule_event_updated',
  'schedule_event_cancelled',
  'schedule_wake_fired',
  'schedule_wake_missed',
  'schedule_wake_merged',
  // ADR 0038：连续输入合流（复用 inbound_wake / model_skip / outbound，不新增 kind）
  'merge_window_joined',
  'merge_window_flushed',
  'merge_reply_stale_discarded',
  'merge_reply_stale_sent',
  'merge_on_behalf_denied',
  'danmaku_window_picked',
  'hard_gate_scene_pending_cap',
  // ADR 0039 切片 A：动态群管规则（`ai_group_rules`）状态迁移
  'rule_drafted',
  'rule_submitted',
  'rule_approved',
  'rule_rejected',
  'rule_expired',
  'rule_disabled',
  'rule_superseded',
  'rule_hash_mismatch',
  'rule_draft_forbidden',
  // ADR 0039：规则命中与执行（执行器见切片 C / D）
  'rule_hit_remind',
  'rule_hit_warn',
  'rule_hit_mute',
  'rule_hit_kick_suggested',
  'rule_hit_exempt',
  'rule_hit_bot_not_admin',
  'rule_hit_flood',
  // ADR 0040 §7：受控自我进化 起草 / 试跑 → 审批 → 生效 / 恢复
  'change_drafted',
  'change_quota_exceeded',
  'change_pruned',
  'change_path_forbidden',
  'change_config_key_forbidden',
  'change_trial_passed',
  'change_trial_failed',
  'change_submitted',
  'change_approved',
  'change_rejected',
  'change_expired',
  'change_hash_mismatch',
  'change_applied_none',
  'change_applied_reload',
  'change_restart_requested',
  'change_verified',
  'change_rolled_back',
  'change_failed_emergency_stop',
  'change_report_sent',
  'change_report_redirected',
  // #1051 F1：需要重启的变更遇到无守护进程的实例
  'change_restart_unavailable',
  // #1051 F4：起草权限（只有主人 / 审批人）与全实例待审上限
  'change_draft_forbidden',
  'change_pending_cap_reached',
  // Configuration outcome/ownership requires manual verification; neither implies emergency stop.
  'change_config_unconfirmed',
  'change_config_superseded',
  // #1250：回合内审批（普通审批 / 读取外部内容后的确认）无人可问：无人值守回合，或会话没有审批渠道
  'tool_approval_unavailable',
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
/** 规范化后以这些结尾的键名也视为密钥，例如 `openaiApiKey`、`DB_PASSWORD`、`githubToken`。 */
const SECRET_KEY_SUFFIXES = ['token', 'secret', 'password', 'passwd', 'apikey', 'privatekey', 'credential', 'credentials', 'cookie'];

/**
 * 键名是否像密钥：命中审计密钥键表（去掉 `-` / `_`、小写后），或以常见密钥后缀结尾。
 * 供审批详情 / IM 摘录这类展示正文的地方使用；`redactDecisionPayload` 本身仍只按键表精确匹配。
 */
export function isSecretLikeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SECRET_KEYS.has(normalized) || SECRET_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

/** 键名是否是提示词类（完整提示词不得外露，审计里替换为 `[omitted]`）。 */
export function isPromptPayloadKey(key: string): boolean {
  return PROMPT_KEYS.has(normalizeKey(key));
}

/** 提示词类键名：完整提示词不得入审计。 */
const PROMPT_KEYS = new Set([
  'prompt', 'systemprompt', 'system', 'messages', 'instructions', 'rawprompt', 'fullprompt',
]);

/** Name fragments that mark an env variable, flag or header as carrying a secret. */
const SECRET_NAME = '(?:token|secret|password|passwd|pwd|api[-_]?key|private[-_]?key|access[-_]?key|credentials?|cookie|session[-_]?id)';

const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `Authorization: token abc`, `Proxy-Authorization: Basic …` — the whole credential.
  [/\b((?:proxy-)?authorization)\s*([:=])\s*(?:(?:bearer|basic|token|digest)\s+)?[^\s"',;]{4,}/gi, `$1$2 ${REDACTED}`],
  // `X-Api-Key: …`, `X-Auth-Token: …`
  [new RegExp(`\\b(x-[a-z0-9-]*(?:${SECRET_NAME}|auth)[a-z0-9-]*)\\s*:\\s*[^\\s"',;]+`, 'gi'), `$1: ${REDACTED}`],
  // `FOO_TOKEN=…`, `export API_KEY="…"`, `DB_PASSWORD: …` (env / config assignments).
  // Quoted values keep their quotes: `apiKey = "[redacted]"`.
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(?!["'\\[])[^\\s;&|"']+`, 'gi'), `$1${REDACTED}`],
  // `--password=…`, `--token …`, `--api-key …`
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(?!["'\\[])[^\\s"']+`, 'gi'), `$1${REDACTED}`],
  // `https://user:pass@host` — keep the user, hide the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s/@]+@/gi, `$1:${REDACTED}@`],
  // JWT (`eyJ…`), AWS access key ids, Google API keys.
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat|xox[abpr])_[A-Za-z0-9_]{8,}/g, REDACTED],
  [/\b(?:SESSDATA|bili_jct|cookie)\s*[=:]\s*[^;\s]+/gi, REDACTED],
];

function normalizeKey(key: string): string {
  return key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
}

/** Masks token-shaped text (bearer / API keys / cookies) without truncating; for display surfaces. */
export function redactSecretText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

/**
 * Display-only masking for approval prompts (#1250: they may be shown in a chat): secret-named keys and
 * token-shaped text are hidden. Execution, fingerprints and approval scope keys still use the exact arguments.
 */
export function redactApprovalDisplay(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactApprovalDisplay(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    isSecretLikeKey(key) && item !== undefined && item !== null && item !== '' ? REDACTED : redactApprovalDisplay(item, depth + 1),
  ]));
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
