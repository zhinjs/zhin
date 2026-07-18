/**
 * 统一工具安全策略门面（policy facade）
 *
 * 背景：builtin 工具曾各自手写策略链且不一致（edit_file 七层、glob/list_dir 两层、
 * analyze_media 三层……），新工具容易漏层，新策略要改所有工具。
 *
 * 本模块把各策略层声明为一张按 priority 排序的策略表，`runToolPolicies` 依序执行，
 * 第一个终结决策（deny 或需 Owner 确认）即短路返回，`decisions` 记录已执行层。
 *
 * 层顺序（以 edit-file-tool 既有链路为基准）：
 *   role-gate → bash-command-safety → dangerous-tool-approval → bash-sensitive-read
 *   → file-permission-matrix（文件写类 + 显式 read）→ bash-file-permission
 *   → memory-write-path（写类且有 filePath）→ sensitive-path（有 filePath）
 *   → blocked-device-path（写类且有 filePath；read_file 经 devicePathGuard 显式启用）
 *   → workspace-access（写类且有 filePath）
 *   → exec-policy（有 command 且给 config）
 *
 * 注意：memory-write-path / blocked-device-path / workspace-access 仅对写操作生效，
 * 这是为了严格保持 read 类工具（glob/list_dir/grep/analyze_media）迁移前的对外行为。
 * bash-tool 旧链不含 exec-policy，因此 bash 调用方不传 config，exec-policy 层不会激活。
 */

import type { Message, Plugin } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../config/index.js';
import { checkMemoryWritePath } from '../memory-layers.js';
import { checkFileAccess, checkBashCommandSafety, isBlockedDevicePath } from './file-policy.js';
import {
  checkBashFilePermission,
  checkFilePermission,
  formatFilePermissionMessage,
  toolRequesterRoleToFileRole,
  type FileOperation,
  type FilePermissionResult,
} from './file-role-policy.js';
import {
  checkBashSensitiveReadAccess,
  checkDangerousToolAccess,
  checkFileToolAccess,
  checkSensitiveFilePathAccess,
  toDenyError,
  toOwnerSignal,
  type DangerousToolDecision,
  type FileToolName,
} from './dangerous-tool-policy.js';
import { checkExecPolicyWithOptions } from './exec-policy.js';
import { resolveToolRequesterRole, type ToolRequesterRole } from './owner-approve-always-store.js';

// ── 输入 / 输出类型 ─────────────────────────────────────────────────

export interface ToolPolicyInput {
  /** 工具名：'read_file'|'edit_file'|'write_file'|'glob'|'list_dir'|'bash'|'web_fetch'|... */
  toolName: string;
  /** 目标路径（文件类工具；已按工具既有行为 expandHome 后传入） */
  filePath?: string;
  /**
   * 未 expandHome 的原始路径，仅供 file-permission-matrix 层使用
   * （旧实现中权限矩阵在 expandHome 之前执行，为保持等价单独透传）。
   */
  rawFilePath?: string;
  /** 覆盖从 toolName 推导的文件操作类型（edit_file→update，write_file→create） */
  fileOperation?: FileOperation;
  /** bash 命令（exec-policy 与 bash 三层用） */
  command?: string;
  /** bash-file-permission 层解析角色用的宿主插件（与 bash-tool 构造注入一致） */
  hostPlugin?: Plugin;
  /**
   * 读类工具显式启用 blocked-device-path 层（仅 read_file；
   * analyze_media 不启用以保持旧行为；拒绝文案也用读类措辞）。
   */
  devicePathGuard?: boolean;
  commMessage?: Message;
  /** exec policy 用配置 */
  config?: Required<ZhinAgentConfig>;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
  /** 需 Owner/二次确认（gate）；allowed=true 时同样终结执行 */
  needsOwnerApproval?: boolean;
  role?: ToolRequesterRole;
  /** 各层原始结果（FilePermissionResult / DangerousToolDecision / ExecPolicyResult ...） */
  payload?: unknown;
}

export interface ToolPolicyLayerRecord {
  policy: string;
  decision: ToolPolicyDecision;
}

export interface ToolPolicyResult extends ToolPolicyDecision {
  /** 产生终结决策的策略名（全部通过时无） */
  deniedBy?: string;
  /** 已执行层的决策记录 */
  decisions: ReadonlyArray<ToolPolicyLayerRecord>;
}

// ── 声明式策略表 ────────────────────────────────────────────────────

export interface ToolPolicyLayer {
  name: string;
  priority: number;
  applies(input: ToolPolicyInput): boolean;
  check(input: ToolPolicyInput, prior: ReadonlyArray<ToolPolicyLayerRecord>): ToolPolicyDecision;
}

const FILE_TOOL_NAMES = new Set(['read_file', 'list_dir', 'glob', 'grep', 'write_file', 'edit_file']);
const DANGEROUS_TOOL_NAMES = new Set(['write_file', 'edit_file', 'web_fetch']);
const WRITE_OPERATIONS = new Set<FileOperation>(['create', 'update', 'delete']);

/** 解析文件操作类型：显式 fileOperation 优先，其次按 toolName 推导（仅写类工具） */
function resolveFileOperation(input: ToolPolicyInput): FileOperation | undefined {
  if (input.fileOperation) return input.fileOperation;
  if (input.toolName === 'edit_file') return 'update';
  if (input.toolName === 'write_file') return 'create';
  return undefined;
}

/** 是否为文件写类调用（memory/device/workspace 层的生效条件） */
function isWriteAccess(input: ToolPolicyInput): boolean {
  const op = resolveFileOperation(input);
  return Boolean(input.filePath) && op !== undefined && WRITE_OPERATIONS.has(op);
}

function fromDangerousDecision(d: DangerousToolDecision): ToolPolicyDecision {
  return {
    allowed: d.allowed,
    reason: d.reason,
    needsOwnerApproval: d.needsOwnerApproval,
    role: d.role,
    payload: d,
  };
}

function sortByPriority(layers: ToolPolicyLayer[]): ToolPolicyLayer[] {
  return layers.sort((a, b) => a.priority - b.priority);
}

const TOOL_POLICIES: ToolPolicyLayer[] = sortByPriority([
  {
    name: 'role-gate',
    priority: 10,
    applies: (input) => FILE_TOOL_NAMES.has(input.toolName),
    check: (input) => fromDangerousDecision(checkFileToolAccess(input.toolName as FileToolName, input.commMessage)),
  },
  {
    name: 'bash-command-safety',
    priority: 15,
    applies: (input) => input.toolName === 'bash' && Boolean(input.command),
    check: (input) => {
      const safety = checkBashCommandSafety(input.command!);
      return { allowed: safety.safe, reason: safety.reason, payload: safety };
    },
  },
  {
    name: 'dangerous-tool-approval',
    priority: 20,
    applies: (input) => DANGEROUS_TOOL_NAMES.has(input.toolName),
    check: (input) =>
      fromDangerousDecision(
        checkDangerousToolAccess(input.toolName as 'write_file' | 'edit_file' | 'web_fetch', input.commMessage),
      ),
  },
  {
    name: 'bash-sensitive-read',
    priority: 25,
    applies: (input) => input.toolName === 'bash' && Boolean(input.command),
    check: (input) => fromDangerousDecision(checkBashSensitiveReadAccess(input.command!, input.commMessage)),
  },
  {
    name: 'file-permission-matrix',
    priority: 30,
    applies: (input) => resolveFileOperation(input) !== undefined,
    check: (input, prior) => {
      const operation = resolveFileOperation(input)!;
      const roleGate = prior.find((r) => r.policy === 'role-gate');
      const requesterRole: ToolRequesterRole = roleGate?.decision.role ?? 'unknown';
      const fileRole = toolRequesterRoleToFileRole(requesterRole);
      const permResult = checkFilePermission(fileRole, operation, input.rawFilePath ?? input.filePath);
      return {
        allowed: permResult.allowed,
        reason: permResult.reason,
        needsOwnerApproval:
          permResult.allowed && (permResult.needsConfirmation === true || permResult.needsOwnerConfirmation === true)
            ? true
            : undefined,
        role: requesterRole,
        payload: permResult,
      };
    },
  },
  {
    name: 'bash-file-permission',
    priority: 35,
    applies: (input) => input.toolName === 'bash' && Boolean(input.command),
    check: (input) => {
      // 与 bash-tool 旧链一致：hostPlugin + commMessage 齐全才解析角色，否则 'unknown'
      const requesterRole: ToolRequesterRole =
        input.commMessage && input.hostPlugin
          ? resolveToolRequesterRole(input.hostPlugin, input.commMessage)
          : 'unknown';
      const role = toolRequesterRoleToFileRole(requesterRole);
      const permResult = checkBashFilePermission(role, input.command!);
      return {
        allowed: permResult.allowed,
        reason: permResult.reason,
        needsOwnerApproval:
          permResult.allowed && (permResult.needsConfirmation === true || permResult.needsOwnerConfirmation === true)
            ? true
            : undefined,
        role: requesterRole,
        payload: permResult,
      };
    },
  },
  {
    name: 'memory-write-path',
    priority: 40,
    applies: (input) => isWriteAccess(input),
    check: (input) => {
      const d = checkMemoryWritePath(input.filePath!, input.commMessage);
      return { allowed: d.allowed, reason: d.reason, payload: d };
    },
  },
  {
    name: 'sensitive-path',
    priority: 50,
    applies: (input) => Boolean(input.filePath),
    check: (input) =>
      fromDangerousDecision(
        checkSensitiveFilePathAccess(input.toolName as FileToolName, input.filePath!, input.commMessage),
      ),
  },
  {
    name: 'blocked-device-path',
    priority: 60,
    applies: (input) => Boolean(input.filePath) && (isWriteAccess(input) || input.devicePathGuard === true),
    check: (input) => {
      if (!isBlockedDevicePath(input.filePath!)) return { allowed: true };
      // 写类措辞与 read_file 读类措辞分别对齐各自旧链文案
      const reason = isWriteAccess(input)
        ? `禁止访问设备路径: ${input.filePath!}`
        : `禁止读取设备文件 ${input.filePath!}（会导致进程挂起或注入攻击）`;
      return { allowed: false, reason };
    },
  },
  {
    name: 'workspace-access',
    priority: 70,
    applies: (input) => isWriteAccess(input),
    check: (input) => {
      const d = checkFileAccess(input.filePath!);
      return { allowed: d.allowed, reason: d.reason, payload: d };
    },
  },
  {
    name: 'exec-policy',
    priority: 80,
    applies: (input) => Boolean(input.command) && Boolean(input.config),
    check: (input) => {
      const r = checkExecPolicyWithOptions(input.config!, input.command!);
      return { allowed: r.allowed, reason: r.reason, needsOwnerApproval: r.needsApproval || undefined, payload: r };
    },
  },
]);

// ── 执行入口 ────────────────────────────────────────────────────────

/**
 * 依 priority 顺序执行适用的策略层；
 * 第一个 `!allowed` 或 `needsOwnerApproval` 的决策即短路返回（deny 优先）。
 */
export function runToolPolicies(input: ToolPolicyInput): ToolPolicyResult {
  const decisions: ToolPolicyLayerRecord[] = [];
  for (const layer of TOOL_POLICIES) {
    if (!layer.applies(input)) continue;
    const decision = layer.check(input, decisions);
    decisions.push({ policy: layer.name, decision });
    if (!decision.allowed || decision.needsOwnerApproval) {
      return { ...decision, deniedBy: layer.name, decisions };
    }
  }
  return { allowed: true, decisions };
}

// ── 结果映射（复刻各工具既有对外文案） ──────────────────────────────

/**
 * 把门面结果映射为工具应返回的字符串；全部通过时返回 null（工具继续执行）。
 * 文案与各工具迁移前逐层手写的返回严格一致。
 */
export function toolPolicyResultToMessage(result: ToolPolicyResult, toolName = ''): string | null {
  if (result.allowed && !result.needsOwnerApproval) return null;
  switch (result.deniedBy) {
    case 'file-permission-matrix':
    case 'bash-file-permission':
      // 覆盖拒绝与 needsConfirmation/needsOwnerConfirmation 两种 gate 文案
      return formatFilePermissionMessage(result.payload as FilePermissionResult, toolName);
    case 'memory-write-path':
      return `Error: ${result.reason}`;
    case 'blocked-device-path':
      return `Error: ${result.reason}`;
    case 'workspace-access':
      return `ZHIN_NEEDS_OWNER:\n${result.reason!}\n\n（文件访问策略拒绝；仅 Owner 确认后在受控环境可重试或调整策略。）`;
    case 'exec-policy':
      return result.needsOwnerApproval
        ? `ZHIN_NEEDS_OWNER:\n${result.reason ?? '该命令需要 Owner 确认。'}`
        : `Error: ${result.reason ?? '该命令已被拒绝。'}`;
    default: {
      // role-gate / dangerous-tool-approval / sensitive-path：统一走 DangerousToolDecision 文案
      const decision: DangerousToolDecision = {
        allowed: result.allowed,
        reason: result.reason,
        needsOwnerApproval: result.needsOwnerApproval,
        role: result.role ?? 'unknown',
      };
      return result.needsOwnerApproval ? toOwnerSignal(decision) : toDenyError(decision);
    }
  }
}
