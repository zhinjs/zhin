/**
 * 受控自我进化：变更对象的规则（ADR 0040 §1 / §6a，切片 A）。
 *
 * 纯函数，不碰磁盘：状态机、`content_hash`、目标路径白名单、禁止的配置键、配额常量。
 * 存储与清理见 `store.ts`。
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { DecisionOutcome, DecisionReasonCode } from '../decision-events.js';
import { classifyHostPath, type HostProtectedPaths } from '../security/host-config-paths.js';

/** 单个变更暂存内容上限（字节，§6a）。 */
export const MAX_CHANGE_BYTES = 5 * 1024 * 1024;
/** 单个变更文件数上限（§6a）。 */
export const MAX_CHANGE_FILES = 50;
/** 整个 `.zhin/changes/` 上限（字节，§6a）。 */
export const MAX_CHANGES_TOTAL_BYTES = 50 * 1024 * 1024;
/** 终态 `change.json` 保留期：14 天，与决策审计默认保留期一致（ADR 0036）。 */
export const DEFAULT_CHANGE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** `draft` / `ready` 未提交、`pending` 未审批的时限：24 小时。 */
export const DEFAULT_CHANGE_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * 批准后到生效的时限（#1051 Q2=B）：进程在批准与生效之间结束，重启时只自动生效 1 小时内批准的残留 `approved`；
 * 更早的转 `expired` 并私聊主人重新起草（批准时的上下文可能已经过时）。
 */
export const DEFAULT_APPROVED_CHANGE_APPLY_WINDOW_MS = 60 * 60 * 1000;
/** 全实例同时等待审批的变更上限（#1051 F4）：挡住多会话刷卡。 */
export const DEFAULT_MAX_PENDING_CHANGES = 3;
/** 定期清理间隔：6 小时（启动时另扫一次）。 */
export const DEFAULT_CHANGE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** `error` 上限（字符）。 */
export const MAX_CHANGE_ERROR_CHARS = 500;
/** 目标路径上限（字符）。 */
export const MAX_CHANGE_PATH_CHARS = 512;

export const SELF_CHANGE_STATUSES = [
  'draft', 'trialing', 'ready', 'pending', 'approved', 'applying', 'verifying', 'applied',
  'trial_failed', 'rejected', 'expired', 'rolled_back', 'failed',
] as const;
export type SelfChangeStatus = typeof SELF_CHANGE_STATUSES[number];

/** 进入即瘦身的终态（删 `files/` 与 `snapshot/`，只留 `change.json`）。`failed` 例外：保留现场直到人处理。 */
export const SELF_CHANGE_TERMINAL_STATUSES: readonly SelfChangeStatus[] = Object.freeze([
  'applied', 'trial_failed', 'rejected', 'expired', 'rolled_back', 'failed',
]);

/** 状态只前进（§1）。`draft → draft` 表示改草稿内容。 */
const TRANSITIONS: Readonly<Record<SelfChangeStatus, readonly SelfChangeStatus[]>> = Object.freeze({
  draft: ['draft', 'trialing', 'expired'],
  trialing: ['ready', 'trial_failed'],
  ready: ['pending', 'expired'],
  pending: ['approved', 'rejected', 'expired'],
  approved: ['applying', 'failed', 'expired'],
  applying: ['verifying', 'applied', 'rolled_back', 'failed'],
  verifying: ['applied', 'rolled_back', 'failed'],
  applied: [],
  trial_failed: [],
  rejected: [],
  expired: [],
  rolled_back: [],
  failed: [],
});

export function isSelfChangeStatus(value: unknown): value is SelfChangeStatus {
  return typeof value === 'string' && (SELF_CHANGE_STATUSES as readonly string[]).includes(value);
}

export function isSelfChangeTerminal(status: SelfChangeStatus): boolean {
  return SELF_CHANGE_TERMINAL_STATUSES.includes(status);
}

export function canTransitionSelfChange(from: SelfChangeStatus, to: SelfChangeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 每个目标状态的默认审计码；`trialing` / `applying` 是中间步骤，由调用方按触发它的动作给码
 * （试跑由起草触发、应用由批准触发），这里不猜。
 */
export const SELF_CHANGE_DEFAULT_REASON: Readonly<Partial<Record<SelfChangeStatus, DecisionReasonCode>>> = Object.freeze({
  draft: 'change_drafted',
  ready: 'change_trial_passed',
  trial_failed: 'change_trial_failed',
  pending: 'change_submitted',
  approved: 'change_approved',
  rejected: 'change_rejected',
  expired: 'change_expired',
  verifying: 'change_restart_requested',
  applied: 'change_verified',
  rolled_back: 'change_rolled_back',
  failed: 'change_failed_emergency_stop',
});

/** `self_change` 审计码对应的 outcome。 */
export function selfChangeOutcome(code: DecisionReasonCode): DecisionOutcome {
  switch (code) {
    case 'change_quota_exceeded':
    case 'change_path_forbidden':
    case 'change_config_key_forbidden':
    case 'change_rejected':
    case 'change_hash_mismatch':
    case 'change_restart_unavailable':
    case 'change_draft_forbidden':
    case 'change_pending_cap_reached':
      return 'deny';
    case 'change_expired':
    case 'change_pruned':
      return 'skip';
    case 'change_submitted':
    case 'change_restart_requested':
    case 'change_config_unconfirmed':
    case 'change_config_superseded':
      return 'defer';
    case 'change_trial_failed':
    case 'change_rolled_back':
    case 'change_failed_emergency_stop':
      return 'error';
    default:
      return 'allow';
  }
}

// ── 目标路径白名单 ────────────────────────────────────────────────────────────

/** 插件约定目录（§1）：相对项目根或已登记的本地插件根。 */
export const CHANGE_CONVENTION_DIRS: readonly string[] = Object.freeze([
  'commands', 'middlewares', 'handlers', 'tools', 'components', 'skills', 'agents',
]);

export class SelfChangePathError extends Error {
  readonly target: string;
  constructor(target: string, reason: string) {
    super(`change target ${JSON.stringify(target)} is not writable: ${reason}`);
    this.target = target;
    this.name = 'SelfChangePathError';
  }
}

export interface ChangePathPolicyInput {
  /** 项目根（绝对路径）。 */
  readonly projectRoot: string;
  /** 宿主注入的受保护路径（P0）；缺省时按名字在任意深度兜底拦截。 */
  readonly protectedPaths?: HostProtectedPaths;
  /** 额外的本地插件根，相对项目根（例如 `plugins/weather`）；项目根本身总是插件根。 */
  readonly pluginRoots?: readonly string[];
}

/**
 * Local plugin roots (relative to the project root) as a fixed list or a provider the host re-reads on every
 * use: the host derives them from the committed generation's source ownership, which is still empty while the
 * first generation is being assembled and changes with every HMR generation.
 */
export type SelfChangePluginRootsSource = readonly string[] | (() => readonly string[]);

/** Turns a {@link SelfChangePluginRootsSource} into a provider of a frozen list. */
export function selfChangePluginRootsProvider(source: SelfChangePluginRootsSource | undefined): () => readonly string[] {
  if (typeof source === 'function') {
    return () => Object.freeze([...source()]);
  }
  const fixedRoots = Object.freeze([...(source ?? [])]);
  return () => fixedRoots;
}

function posixRelative(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * 规范化并校验一个变更目标路径，返回相对项目根的 posix 路径；不允许时抛 {@link SelfChangePathError}。
 *
 * 允许：插件约定目录下的文件、根 `AGENTS.md`、`skills/**`。
 * 拒绝：绝对路径、`..`、P0 A 名单（`node_modules`、lockfile、`.zhin/**`、`.env*`…），以及
 * 白名单之外的一切（含根配置文件——它们只能经 `configPatch` 改）。
 */
export function normalizeChangeTarget(target: string, policy: ChangePathPolicyInput): string {
  if (typeof target !== 'string' || !target.trim()) throw new SelfChangePathError(String(target), 'empty path');
  if (target.length > MAX_CHANGE_PATH_CHARS) throw new SelfChangePathError(target.slice(0, 64), 'path too long');
  if (target.includes('\0')) throw new SelfChangePathError(target, 'NUL in path');
  const unified = posixRelative(target.trim());
  if (unified.startsWith('/') || /^[a-z]:\//iu.test(unified)) throw new SelfChangePathError(target, 'absolute path');
  const segments = unified.split('/');
  if (segments.some(segment => segment === '..')) throw new SelfChangePathError(target, 'parent segment');
  const rel = segments.filter(segment => segment && segment !== '.').join('/');
  if (!rel) throw new SelfChangePathError(target, 'empty path');
  const absolute = path.join(path.resolve(policy.projectRoot), ...rel.split('/'));
  // P0 A 名单（含符号链接解析到受保护文件）一律拒绝，不进审批。
  if (classifyHostPath(absolute, policy.protectedPaths, policy.projectRoot) === 'deny') {
    throw new SelfChangePathError(target, 'host-protected path');
  }
  if (!isAllowedChangeTarget(rel, policy.pluginRoots ?? [])) {
    throw new SelfChangePathError(target, 'outside the writable change scope');
  }
  return rel;
}

function isAllowedChangeTarget(rel: string, pluginRoots: readonly string[]): boolean {
  const folded = rel.toLowerCase();
  if (folded === 'agents.md') return true;
  if (folded.startsWith('skills/') && folded.length > 'skills/'.length) return true;
  const roots = ['', ...pluginRoots.map(root => posixRelative(root).split('/').filter(s => s && s !== '.').join('/').toLowerCase())];
  for (const root of roots) {
    const prefix = root ? `${root}/` : '';
    if (prefix && !folded.startsWith(prefix)) continue;
    const rest = folded.slice(prefix.length).split('/');
    // 约定目录下至少还要有一个文件名。
    if (rest.length >= 2 && CHANGE_CONVENTION_DIRS.includes(rest[0]!) && rest[rest.length - 1]) return true;
  }
  return false;
}

// ── 配置补丁 ─────────────────────────────────────────────────────────────────

/** 与 Console `config:patch` 的单条操作同形（字段级，`path` 为分段数组）。 */
export type SelfChangeConfigOperation =
  | Readonly<{ op: 'set'; path: readonly string[]; value: unknown }>
  | Readonly<{ op: 'remove'; path: readonly string[] }>;

export interface SelfChangeConfigPatch {
  /** 起草时读到的配置 revision；生效前复核，不符即冲突。 */
  readonly expectedRevision: string;
  readonly patches: readonly SelfChangeConfigOperation[];
}

/**
 * 放松安全或扩大工具面的 Host 配置键（点分路径，ADR 0040 §1，#1051 F2）。
 *
 * 补丁写到这些键本身、其子键，或整体覆盖 / 删除其祖先，都直接拒绝，不进审批（「模型不能自解禁」）。
 * `packages/im/runtime/src/host-config-schema.json` 中对应字段必须标 `"x-zhin-config": { "security": true }`，
 * 守卫测试断言两边一一对应：新增安全开关时只在 schema 标记而忘记登记（或反之）会直接失败。
 */
export const SELF_CHANGE_SECURITY_CONFIG_KEYS: readonly string[] = Object.freeze([
  // 硬闸与执行审批
  'ai.agent.toolHardGate',
  'ai.agent.execApprovalMode',
  'ai.agent.subagentExecApprovalMode',
  'ai.agent.workerExecApprovalMode',
  'ai.agent.execSecurity',
  'ai.agent.execPreset',
  'ai.agent.execAllowlist',
  'ai.agent.masterShell',
  'ai.agent.masterShellApprovalMode',
  'ai.agent.toolExecution',
  'ai.agent.injectionGuard',
  'ai.agent.usageQuota.exemptOwner',
  'ai.agent.schedule.security',
  // 工作室信任；模型用途与决策审批配置由认证 Host runtime API 管理。
  'ai.workroom.trustedPackPublishers',
  'ai.workroom.disclosure',
  // 访问令牌
  'http.token',
  'http.tokens',
  // 跨实例执行与回调
  'a2a.workroomRemoteExecutors',
  'a2a.workroomCallbacks',
  // 主人私域策略
  'assistant.home.policy',
  // MCP：对外暴露工具 / 接入新的工具面
  'mcp',
  'ai.mcpServers',
  'ai.githubMcp',
]);

/** {@link SELF_CHANGE_SECURITY_CONFIG_KEYS} 的分段形式。 */
export const FORBIDDEN_CHANGE_CONFIG_KEYS: readonly (readonly string[])[] = Object.freeze(
  SELF_CHANGE_SECURITY_CONFIG_KEYS.map(key => Object.freeze(key.split('.'))),
);

/** 同 Console `CONFIG_PATCH_LIMITS`。 */
const MAX_CONFIG_OPERATIONS = 32;
const MAX_CONFIG_PATH_DEPTH = 16;
const MAX_CONFIG_SEGMENT_CHARS = 128;

export class SelfChangeConfigKeyError extends Error {
  readonly key: string;
  constructor(key: string, reason: string) {
    super(`config patch path ${JSON.stringify(key)} is not allowed: ${reason}`);
    this.key = key;
    this.name = 'SelfChangeConfigKeyError';
  }
}

export class SelfChangeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfChangeValidationError';
  }
}

function isPrefix(prefix: readonly string[], of: readonly string[]): boolean {
  return prefix.length <= of.length && prefix.every((segment, index) => segment === of[index]);
}

/**
 * 返回补丁路径会改到的第一个禁改键；不触及时返回 `null`。
 * 写禁止键本身或其子键，或整体覆盖 / 删除其祖先（`ai.agent = {...}`、`remove ai`）都算改到它。
 */
export function findForbiddenConfigKey(segments: readonly string[]): readonly string[] | null {
  for (const forbidden of FORBIDDEN_CHANGE_CONFIG_KEYS) {
    const writesInsideForbidden = isPrefix(forbidden, segments);
    const overwritesAncestor = isPrefix(segments, forbidden);
    if (writesInsideForbidden || overwritesAncestor) return forbidden;
  }
  return null;
}

function assertConfigPathAllowed(segments: readonly string[]): void {
  const forbidden = findForbiddenConfigKey(segments);
  if (!forbidden) return;
  throw new SelfChangeConfigKeyError(segments.join('.'), `touches ${forbidden.join('.')}`);
}

/**
 * 生效前复核（§5.1）：按当前禁改名单重查已规范化的补丁。
 * 名单扩充前起草并批准的旧变更在这里被拦下，触及禁改键抛 {@link SelfChangeConfigKeyError}。
 */
export function assertConfigPatchAllowed(patch: SelfChangeConfigPatch): void {
  for (const operation of patch.patches) {
    assertConfigPathAllowed(operation.path);
  }
}

/** 校验并冻结配置补丁；触及禁止键抛 {@link SelfChangeConfigKeyError}，形状不对抛 {@link SelfChangeValidationError}。 */
export function normalizeChangeConfigPatch(input: unknown): SelfChangeConfigPatch {
  if (!input || typeof input !== 'object') throw new SelfChangeValidationError('configPatch must be an object');
  const { expectedRevision, patches } = input as { expectedRevision?: unknown; patches?: unknown };
  if (typeof expectedRevision !== 'string' || !expectedRevision.trim()) {
    throw new SelfChangeValidationError('configPatch.expectedRevision is required');
  }
  if (!Array.isArray(patches) || patches.length === 0) throw new SelfChangeValidationError('configPatch.patches must be a non-empty array');
  if (patches.length > MAX_CONFIG_OPERATIONS) throw new SelfChangeValidationError(`configPatch has more than ${MAX_CONFIG_OPERATIONS} operations`);
  const out: SelfChangeConfigOperation[] = [];
  for (const raw of patches) {
    const op = (raw as { op?: unknown })?.op;
    const segments = (raw as { path?: unknown })?.path;
    if (op !== 'set' && op !== 'remove') throw new SelfChangeValidationError('configPatch op must be set or remove');
    if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_CONFIG_PATH_DEPTH
      || !segments.every(s => typeof s === 'string' && s.length > 0 && s.length <= MAX_CONFIG_SEGMENT_CHARS)) {
      throw new SelfChangeValidationError('configPatch path must be 1-16 non-empty string segments');
    }
    assertConfigPathAllowed(segments as string[]);
    const pathCopy = Object.freeze([...(segments as string[])]);
    out.push(op === 'set'
      ? Object.freeze({ op, path: pathCopy, value: (raw as { value?: unknown }).value })
      : Object.freeze({ op, path: pathCopy }));
  }
  return Object.freeze({ expectedRevision: expectedRevision.trim(), patches: Object.freeze(out) });
}

// ── content_hash ─────────────────────────────────────────────────────────────

export type SelfChangeFileOp = 'write' | 'delete';

/** `change.json` 里的文件条目：只有路径与摘要，不含正文。 */
export interface SelfChangeFileEntry {
  readonly path: string;
  readonly op: SelfChangeFileOp;
  /** 内容 sha256（`delete` 为 `null`）。 */
  readonly sha256: string | null;
  readonly bytes: number;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 键排序的稳定 JSON（`undefined` 字段省略，与 `JSON.stringify` 一致）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * 变更的规范化摘要：文件按路径排序后逐条 `op path sha256`，再接配置补丁的稳定 JSON。
 * 审批绑定它（§0.2）；任何文件内容、增删或补丁变化都会改变摘要。
 */
export function selfChangeContentHash(files: readonly SelfChangeFileEntry[], configPatch: SelfChangeConfigPatch | null): string {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(file => `${file.op}\0${file.path}\0${file.sha256 ?? ''}`);
  return sha256Hex(`zhin-self-change/v1\n${lines.join('\n')}\n--\n${configPatch ? canonicalJson(configPatch) : 'null'}`);
}

export function clipChangeError(message: string): string {
  const text = message.trim();
  return text.length > MAX_CHANGE_ERROR_CHARS ? `${text.slice(0, MAX_CHANGE_ERROR_CHARS - 1)}…` : text;
}
