/**
 * ZhinAgent 执行策略 — bash 命令的安全检查与工具包装
 *
 * 参考 Claude Code bashPermissions.ts 的纵深防御策略：
 *   1. 危险命令黑名单  — 即使 full 模式也阻止解释器/提权命令
 *   2. 环境变量前缀剥离 — `FOO=bar cmd` → 按 `cmd` 做白名单匹配
 *   3. Safe wrapper 剥离 — `timeout 10 cmd` → 按 `cmd` 做匹配
 *   4. 复合命令拆分   — `&&` `||` `;` 逐段独立检查，deny 优先
 *   5. 只读命令自动放行 — 与 file-policy classifyBashCommand 集成
 *   6. ask_user 集成  — execAsk=true 时返回需审批标记（而非无法交互的抛错）
 */

import type { AgentTool } from '@zhin.js/core';
import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import { classifyBashCommand } from './file-policy.js';

// ── 预设命令白名单 ──────────────────────────────────────────────────

const PRESET_READONLY = ['ls', 'cat', 'pwd', 'date', 'whoami', 'grep', 'find', 'head', 'tail', 'wc', 'stat', 'file'];
const PRESET_NETWORK = [...PRESET_READONLY, 'curl', 'wget', 'ping', 'dig', 'nslookup', 'host'];
const PRESET_DEVELOPMENT = [...PRESET_NETWORK, 'npm', 'npx', 'node', 'git', 'gh', 'python', 'python3', 'pip', 'pnpm', 'yarn', 'tsc', 'bun'];

export const EXEC_PRESETS: Record<string, string[]> = {
  readonly: PRESET_READONLY,
  network: PRESET_NETWORK,
  development: PRESET_DEVELOPMENT,
};

// ── 危险命令黑名单（参考 Claude Code DANGEROUS_COMMANDS）──────────────

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
 * 检查命令是否在危险黑名单中。
 */
export function isDangerousCommand(cmdName: string): boolean {
  return DANGEROUS_COMMANDS.has(cmdName);
}

// ── 环境变量前缀剥离（参考 Claude Code stripEnvVars）──────────────

/**
 * 剥离命令前面的 `KEY=value` 环境变量前缀。
 * 例如 `FOO=bar BAZ=1 curl http://...` → `curl http://...`
 *
 * 只剥离安全的 key=value 对，不剥离含特殊字符的值（可能是注入）。
 */
export function stripEnvVarPrefix(command: string): string {
  // env 前缀环境变量格式: WORD=VALUE (VALUE 可以被引号或不含空格的字符串)
  return command.replace(
    /^(\s*[A-Za-z_][A-Za-z0-9_]*=(('[^']*'|"[^"]*"|[^\s;|&]*))\s*)+/,
    '',
  ).trim();
}

// ── Safe wrapper 剥离（参考 Claude Code stripSafeWrappers）──────────

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

// ── 复合命令拆分（参考 Claude Code compound command checking）──────

/**
 * 将复合命令按 `&&`, `||`, `;` 拆分为独立子命令。
 * 管道 `|` 不拆分 — 管道中的只读性由 classifyBashCommand 判断。
 *
 * 注意：不处理 subshell `$(...)` 和反引号 — 这些场景由危险黑名单覆盖。
 */
export function splitCompoundCommand(command: string): string[] {
  // 按 &&, ||, ; 拆分，保留管道作为整体
  return command.split(/\s*(?:&&|\|\||;)\s*/).map(s => s.trim()).filter(Boolean);
}

/**
 * 从命令字符串中提取实际的可执行程序名。
 * 先剥离环境变量前缀和 safe wrapper。
 */
export function extractCommandName(command: string): string {
  const stripped = stripSafeWrappers(stripEnvVarPrefix(command));
  // 取第一个非管道 token
  const name = stripped.split(/[\s|]/)[0] || '';
  return name;
}

// ── 策略检查结果 ────────────────────────────────────────────────────

export interface ExecPolicyResult {
  allowed: boolean;
  /** 如果不允许，拒绝原因 */
  reason?: string;
  /** 如果需要用户确认（execAsk=true 且命令不在白名单但也不在黑名单） */
  needsApproval?: boolean;
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

/**
 * 检查单条子命令是否允许执行。
 * 内部函数 — 不做复合命令拆分。
 */
function checkSingleCommand(
  cmdName: string,
  fullSubCommand: string,
  allowlist: string[],
  security: string,
  execAsk: boolean,
): ExecPolicyResult {
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
    return { allowed: true };
  }

  // 5. 需审批或拒绝
  if (execAsk) {
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
    return { allowed: false, reason: '当前配置禁止执行 Shell 命令（execSecurity=deny）。如需开放请在配置中设置 ai.agent.execSecurity。' };
  }

  const allowlist = resolveExecAllowlist(config);
  const execAsk = config.execAsk ?? false;
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

    const result = checkSingleCommand(cmdName, sub, allowlist, security, execAsk);

    // deny 立即返回（deny > ask 优先级）
    if (!result.allowed && !result.needsApproval) {
      return result;
    }

    // 记录第一个需要审批的
    if (!result.allowed && result.needsApproval && !pendingApproval) {
      pendingApproval = result;
    }
  }

  // 有需要审批的段
  if (pendingApproval) {
    return pendingApproval;
  }

  return { allowed: true };
}

/**
 * Wrap `bash` tools with exec policy enforcement.
 * 当 execAsk=true 且命令需审批时，返回提示信息而非抛错。
 */
export function applyExecPolicyToTools(config: Required<ZhinAgentConfig>, tools: AgentTool[]): AgentTool[] {
  return tools.map(t => {
    if (t.name !== 'bash') return t;
    const original = t.execute;
    return {
      ...t,
      execute: async (args: Record<string, any>) => {
        const cmd = args?.command != null ? String(args.command) : '';
        const result = checkExecPolicy(config, cmd);
        if (!result.allowed) {
          if (result.needsApproval) {
            // 返回可读消息让 AI 用 ask_user 向 Owner 确认
            return `⚠️ ${result.reason}\n请使用 ask_user 工具向 Owner 确认是否允许执行此命令。`;
          }
          throw new Error(result.reason!);
        }
        return original(args);
      },
    };
  });
}
