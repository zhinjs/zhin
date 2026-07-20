/**
 * ZhinAgent 执行策略 — bash 命令的安全检查与工具包装
 *
 *   1. 危险命令黑名单  — 即使 full 模式也阻止解释器/提权命令
 *   2. 环境变量前缀剥离 — `FOO=bar cmd` → 按 `cmd` 做白名单匹配
 *   3. Safe wrapper 剥离 — `timeout 10 cmd` → 按 `cmd` 做匹配
 *   4. 复合命令拆分   — `&&` `||` `;` 逐段独立检查，deny 优先
 *   5. 只读命令自动放行 — 与 file-policy classifyBashCommand 集成
 *   6. Owner 信号 — execApprovalMode=ask 时返回需审批（ZHIN_NEEDS_OWNER），由编排层可硬触发 ask_user
 */

import type { AgentTool } from '@zhin.js/ai';
import { getHostRootPlugin } from '@zhin.js/core';
import type { ZhinAgentConfig, ExecApprovalMode } from '../config/index.js';
import { classifyBashCommand } from './file-policy.js';
import { validateNetworkCommandUrl } from './network-policy.js';
import { getCurrentCommMessage } from './comm-message-context.js';
import {
  isIcqqSensitiveSubcommand,
  matchesBashOwnerExecBypass,
  resolveToolRequesterRole,
  type ToolRequesterRole,
} from './owner-approve-always-store.js';
import { getAuditLogger } from './audit-logger.js';

// ── 预设命令白名单 ──────────────────────────────────────────────────

const PRESET_READONLY = ['ls', 'cat', 'pwd', 'date', 'whoami', 'grep', 'find', 'head', 'tail', 'wc', 'stat', 'file'];
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

function matchHardBlockedCommand(command: string): string | undefined {
  const lower = command.trim().toLowerCase();
  if (/\b(?:rm|rmdir)\b/.test(lower) && lower.includes('node_modules')) {
    return '拒绝删除依赖目录 node_modules（高风险破坏操作）。';
  }
  if (lower.includes('find') && lower.includes('node_modules') && lower.includes('-delete')) {
    return '拒绝通过 find -delete 删除 node_modules（高风险破坏操作）。';
  }
  return undefined;
}

// ── 环境变量前缀剥离──────────────

/**
 * 剥离命令前面的 `KEY=value` 环境变量前缀。
 * 例如 `FOO=bar BAZ=1 curl http://...` → `curl http://...`
 *
 * 只剥离安全的 key=value 对，不剥离含特殊字符的值（可能是注入）。
 */
function tryStripOneEnvAssignment(command: string): { rest: string; stripped: boolean } {
  const trimmed = command.trimStart();
  const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!keyMatch) return { rest: command, stripped: false };
  let i = keyMatch[0].length;
  const ch = trimmed[i];
  if (ch === "'") {
    const end = trimmed.indexOf("'", i + 1);
    if (end === -1) return { rest: command, stripped: false };
    i = end + 1;
  } else if (ch === '"') {
    const end = trimmed.indexOf('"', i + 1);
    if (end === -1) return { rest: command, stripped: false };
    i = end + 1;
  } else {
    while (i < trimmed.length && !/[\s;|&]/.test(trimmed[i])) i++;
  }
  while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
  return { rest: trimmed.slice(i), stripped: true };
}

export function stripEnvVarPrefix(command: string): string {
  let rest = command;
  for (let n = 0; n < 32; n++) {
    const next = tryStripOneEnvAssignment(rest);
    if (!next.stripped) break;
    rest = next.rest;
  }
  return rest.trim();
}

// ── Safe wrapper 剥离──────────────

/**
 * Safe wrapper 命令列表 — 这些命令本身是安全的"包装器"，
 * 真正需要检查的是它们后面的实际命令。
 */
const SAFE_WRAPPERS: ReadonlySet<string> = new Set([
  'timeout', 'time', 'nice', 'nohup', 'ionice', 'stdbuf', 'unbuffer',
]);

/**
 * 剥离命令前面的 safe wrapper（如 `timeout 10`、`nice -n 5`）。
 * 只剥离 wrapper + 它的标志/参数（数字、-flag 形式），直到遇到实际命令。
 */
export function stripSafeWrappers(command: string): string {
  let remaining = command.trim();
  let changed = true;
  // 防止无限循环，最多剥离 5 层
  let maxIter = 5;
  while (changed && maxIter-- > 0) {
    changed = false;
    const tokens = remaining.split(/\s+/);
    if (tokens.length < 2) break;
    if (SAFE_WRAPPERS.has(tokens[0])) {
      // 跳过 wrapper 本身和它的参数（-flag 或纯数字/duration）
      let i = 1;
      while (i < tokens.length && /^(-[A-Za-z0-9]|[0-9]+[smhd]?$)/.test(tokens[i])) {
        i++;
      }
      if (i < tokens.length) {
        remaining = tokens.slice(i).join(' ');
        changed = true;
      }
    }
  }
  return remaining;
}

// ── 复合命令拆分──────────────

/**
 * 将复合命令按 `&&`, `||`, `;` 拆分为独立子命令。
 * 管道 `|` 不拆分 — 管道中的只读性由 classifyBashCommand 判断。
 *
 * 引号/转义感知：单引号内为字面量；双引号与裸文本内 `\` 转义下一个字符；
 * 引号内的分隔符不拆分（`echo "a && b"` 是单命令）。
 * 引号未闭合时 fail-closed：整条按单命令返回（不拆分），
 * 避免把藏在残缺引号后的危险段漏检。
 *
 * 注意：不处理 subshell `$(...)` 和反引号 — 这些场景由危险黑名单覆盖。
 */
export function splitCompoundCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }
    // 单引号内没有转义；双引号/裸文本内 \ 转义下一字符
    if (ch === '\\' && quote !== 'single') {
      current += ch;
      escaped = true;
      i++;
      continue;
    }
    if (quote === 'single') {
      if (ch === "'") quote = null;
      current += ch;
      i++;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      current += ch;
      i++;
      continue;
    }
    if (command.startsWith('&&', i) || command.startsWith('||', i) || ch === ';') {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      if (command.startsWith('&&', i)) i += 2;
      else if (command.startsWith('||', i)) i += 2;
      else i += 1;
      while (i < command.length && /\s/.test(command[i])) i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (quote !== null || escaped) return [command];
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * 从命令字符串中提取实际的可执行程序名。
 * 先剥离环境变量前缀和 safe wrapper，再对首 token 去引号/转义，
 * 防止 `"rm"`、`'rm'`、`r\m` 这类引号变体绕过黑名单精确匹配。
 */
export function extractCommandName(command: string): string {
  const stripped = stripSafeWrappers(stripEnvVarPrefix(command));
  // 取第一个非管道 token
  const name = stripped.split(/[\s|]/)[0] || '';
  return unquoteToken(name);
}

/** 去除 token 外层的引号与转义（POSIX 风格：单引号字面、双引号内 \\ 仅转义 " \ $ `）。 */
function unquoteToken(token: string): string {
  let out = '';
  let quote: 'single' | 'double' | null = null;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]!;
    if (quote === 'single') {
      if (ch === "'") quote = null;
      else out += ch;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < token.length && '"\\$`'.includes(token[i + 1]!)) out += token[++i];
      else out += ch;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      continue;
    }
    if (ch === '\\' && i + 1 < token.length) {
      out += token[++i];
      continue;
    }
    out += ch;
  }
  return out;
}

// ── 策略检查结果 ────────────────────────────────────────────────────

export interface ExecPolicyResult {
  allowed: boolean;
  /** 如果不允许，拒绝原因 */
  reason?: string;
  /** 如果需要用户确认（execApprovalMode=ask 且命令不在白名单但也不在黑名单） */
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
}

export interface CheckExecPolicyOptions {
  /** 覆盖配置中的审批模式 */
  approvalMode?: ExecApprovalMode;
}

function resolveRequesterRole(): ToolRequesterRole {
  const commMessage = getCurrentCommMessage();
  if (!commMessage?.$adapter || !commMessage?.$endpoint || !commMessage?.$sender?.id) return 'unknown';

  try {
    const plugin = getHostRootPlugin();
    if (!plugin) return 'unknown';
    return resolveToolRequesterRole(plugin, commMessage);
  } catch {
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

function tryExecBypassForSensitiveIcqq(normalizedSubCommand: string): boolean {
  const commMessage = getCurrentCommMessage();
  if (!commMessage?.$adapter || !commMessage?.$endpoint) return false;
  try {
    const plugin = getHostRootPlugin();
    if (!plugin) return false;
    return matchesBashOwnerExecBypass(plugin, commMessage, normalizedSubCommand);
  } catch {
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

  // 3.5 icqq CLI（allowlist 模式）：非敏感子命令直接放行；敏感子命令可走 Owner 正则/永久放行
  if (security === 'allowlist' && cmdName === 'icqq') {
    const norm = stripSafeWrappers(stripEnvVarPrefix(fullSubCommand.trim()));
    if (!isIcqqSensitiveSubcommand(norm)) {
      return { allowed: true };
    }
    if (tryExecBypassForSensitiveIcqq(norm)) {
      return { allowed: true };
    }
    if (requesterRole === 'master') {
      return { allowed: true };
    }
    if (requesterRole === 'trusted') {
      return {
        allowed: false,
        needsApproval: true,
        reason: `icqq 敏感操作不在 execAllowlist，需 Owner 确认：${norm.slice(0, 280)}`,
      };
    }
    if (requesterRole === 'other') {
      return {
        allowed: false,
        reason: `icqq 敏感操作仅允许 owner 直接执行；admin 需 Owner 审批：${norm.slice(0, 280)}`,
      };
    }
    if (approvalMode === 'allow') {
      return { allowed: true };
    }
    if (approvalMode === 'ask') {
      return {
        allowed: false,
        needsApproval: true,
        reason: `icqq 敏感操作需 Endpoint Owner 确认：${norm.slice(0, 280)}`,
      };
    }
    return {
      allowed: false,
      reason: `icqq 敏感操作已被拒绝（execApprovalMode=deny）：${norm.slice(0, 280)}`,
    };
  }

  // 4. 白名单匹配
  const allowed = allowlist.some(pattern => {
    try {
      const re = new RegExp(`^${pattern}$`);
      return re.test(cmdName);
    } catch {
      return cmdName === pattern;
    }
  });

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
  if (approvalMode === 'allow') {
    return { allowed: true };
  }

  if (approvalMode === 'ask') {
    return {
      allowed: false,
      needsApproval: true,
      reason: `命令「${cmdName}」不在允许列表中，需要用户确认后执行。`,
    };
  }

  return {
    allowed: false,
    reason: `命令「${cmdName}」不在允许列表中，已被拒绝。可将命令加入 ai.agent.execAllowlist 或改用 execPreset。`,
  };
}

/**
 * Check if a bash command is allowed under the current exec policy.
 * 支持复合命令拆分、环境变量剥离、safe wrapper 剥离、只读自动放行。
 *
 * @returns ExecPolicyResult — 允许/拒绝/需审批
 */
export function checkExecPolicy(config: Required<ZhinAgentConfig>, command: string): ExecPolicyResult {
  const security = config.execSecurity ?? 'deny';
  if (security === 'deny') {
    const result = { allowed: false, reason: '当前配置禁止执行 Shell 命令（execSecurity=deny）。如需开放请在配置中设置 ai.agent.execSecurity。' };

    // 记录审计日志
    try {
      const auditLogger = getAuditLogger();
      auditLogger.logExecPolicy(command, false, result.reason);
    } catch {
      // 忽略审计日志错误
    }

    return result;
  }

  const allowlist = resolveExecAllowlist(config);
  const approvalMode = resolveExecApprovalMode(config);
  const requesterRole = resolveRequesterRole();
  const cmd = (command || '').trim();

  if (!cmd) {
    return { allowed: false, reason: '命令为空' };
  }

  // 拆分复合命令 — 每段独立检查，deny 优先
  const subCommands = splitCompoundCommand(cmd);
  let pendingApproval: ExecPolicyResult | null = null;

  for (const sub of subCommands) {
    const cmdName = extractCommandName(sub);
    if (!cmdName) continue;

    const result = checkSingleCommand(cmdName, sub, allowlist, security, approvalMode, requesterRole);

    // deny 立即返回（deny > ask 优先级）
    if (!result.allowed && !result.needsApproval) {
      // 记录审计日志
      try {
        const auditLogger = getAuditLogger();
        auditLogger.logExecPolicy(sub, false, result.reason);
      } catch {
        // 忽略审计日志错误
      }

      return result;
    }

    // 记录第一个需要审批的
    if (!result.allowed && result.needsApproval && !pendingApproval) {
      pendingApproval = result;
    }
  }

  // 有需要审批的段
  if (pendingApproval) {
    // 记录审计日志
    try {
      const auditLogger = getAuditLogger();
      auditLogger.logExecPolicy(cmd, false, pendingApproval.reason);
    } catch {
      // 忽略审计日志错误
    }

    return pendingApproval;
  }

  // 记录成功的审计日志
  try {
    const auditLogger = getAuditLogger();
    auditLogger.logExecPolicy(cmd, true);
  } catch {
    // 忽略审计日志错误
  }

  return { allowed: true };
}

export function checkExecPolicyWithOptions(
  config: Required<ZhinAgentConfig>,
  command: string,
  options: CheckExecPolicyOptions = {},
): ExecPolicyResult {
  if (!options.approvalMode) {
    return checkExecPolicy(config, command);
  }
  const shadowConfig = {
    ...config,
    execApprovalMode: options.approvalMode,
  } as Required<ZhinAgentConfig>;
  return checkExecPolicy(shadowConfig, command);
}

/**
 * Wrap `bash` tools with exec policy enforcement.
 * 当 execApprovalMode=ask 且命令需审批时，返回提示信息而非抛错。
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
