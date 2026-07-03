/**
 * RoleCapabilityPolicy — 在 turn 工具装配时按 pipelineRole 强制 ACL（ADR 0024 I5）。
 *
 * 复用 AGENT_ROLE_CONFIGS 的 allowedTools/blockedTools；'*' 表示放行全部。
 */
import { AGENT_ROLE_CONFIGS, type AgentRole } from '../../orchestrator/agent-dispatcher.js';
import { isPipelineRole, type PipelineRole } from '../../collaboration/types.js';

export function isToolAllowedForRole(toolName: string, role: AgentRole): boolean {
  const cfg = AGENT_ROLE_CONFIGS[role];
  if (!cfg) return true;
  if (cfg.blockedTools.includes(toolName)) return false;
  if (cfg.allowedTools.includes('*')) return true;
  return cfg.allowedTools.includes(toolName);
}

/** 过滤工具名列表，仅保留该角色允许的工具。 */
export function filterToolNamesForRole(names: string[], role: PipelineRole): string[] {
  return names.filter((n) => isToolAllowedForRole(n, role));
}

/** 过滤带 name 字段的工具对象列表。 */
export function filterToolsForRole<T extends { name: string }>(tools: T[], role: PipelineRole): T[] {
  return tools.filter((t) => isToolAllowedForRole(t.name, role));
}

export function asPipelineRole(value: unknown): PipelineRole | undefined {
  return isPipelineRole(value) ? value : undefined;
}
