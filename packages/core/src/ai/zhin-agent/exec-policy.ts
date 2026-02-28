/**
 * ZhinAgent 执行策略 — bash 命令的安全检查与工具包装
 */

import type { AgentTool } from '../types.js';
import type { ZhinAgentConfig } from './config.js';

// ── 预设命令白名单 ──────────────────────────────────────────────────

const PRESET_READONLY = ['ls', 'cat', 'pwd', 'date', 'whoami', 'grep', 'find', 'head', 'tail', 'wc'];
const PRESET_NETWORK = [...PRESET_READONLY, 'curl', 'wget', 'ping', 'dig'];
const PRESET_DEVELOPMENT = [...PRESET_NETWORK, 'npm', 'npx', 'node', 'git', 'gh', 'python', 'python3', 'pip', 'pnpm', 'yarn'];

export const EXEC_PRESETS: Record<string, string[]> = {
  readonly: PRESET_READONLY,
  network: PRESET_NETWORK,
  development: PRESET_DEVELOPMENT,
};

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
 * Check if a bash command is allowed under the current exec policy.
 * Throws an Error when the command is denied.
 */
export function checkExecPolicy(config: Required<ZhinAgentConfig>, command: string): void {
  const security = config.execSecurity ?? 'deny';
  if (security === 'full') return;
  if (security === 'deny') {
    throw new Error('当前配置禁止执行 Shell 命令（execSecurity=deny）。如需开放请在配置中设置 ai.agent.execSecurity。');
  }
  // allowlist
  const list = resolveExecAllowlist(config);
  const cmd = (command || '').trim();
  const allowed = list.some(pattern => {
    try {
      const re = new RegExp(pattern);
      return re.test(cmd);
    } catch {
      return cmd === pattern || cmd.startsWith(pattern);
    }
  });
  if (!allowed) {
    const ask = config.execAsk;
    throw new Error(
      ask
        ? '该命令不在允许列表中，需要审批后执行。当前版本请将命令加入 ai.agent.execAllowlist 或联系管理员。'
        : '该命令不在允许列表中，已被拒绝执行。可将允许的命令模式加入 ai.agent.execAllowlist。',
    );
  }
}

/**
 * Wrap `bash` tools with exec policy enforcement.
 */
export function applyExecPolicyToTools(config: Required<ZhinAgentConfig>, tools: AgentTool[]): AgentTool[] {
  return tools.map(t => {
    if (t.name !== 'bash') return t;
    const original = t.execute;
    return {
      ...t,
      execute: async (args: Record<string, any>) => {
        const cmd = args?.command != null ? String(args.command) : '';
        checkExecPolicy(config, cmd);
        return original(args);
      },
    };
  });
}
