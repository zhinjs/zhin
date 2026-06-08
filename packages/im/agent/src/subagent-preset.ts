/**
 * Sub-agent 预设解析：role / contextMode（对齐 pi-subagents frontmatter 与默认映射）
 */
import type { AgentMeta } from './discovery/agents.js';
import type { AgentRole } from './orchestrator/agent-dispatcher.js';

export type SubagentContextMode = 'fork' | 'fresh';

const KNOWN_ROLES: ReadonlySet<string> = new Set([
  'main', 'subtask', 'worker', 'researcher', 'executor', 'reviewer', 'planner',
]);

const PRESET_ROLE_BY_NAME: Record<string, AgentRole> = {
  reviewer: 'reviewer',
  planner: 'planner',
  researcher: 'researcher',
  scout: 'researcher',
  explorer: 'researcher',
  worker: 'subtask',
  executor: 'executor',
};

const DEFAULT_CONTEXT_MODE_BY_ROLE: Record<AgentRole, SubagentContextMode> = {
  main: 'fork',
  subtask: 'fork',
  worker: 'fork',
  researcher: 'fork',
  executor: 'fork',
  reviewer: 'fresh',
  planner: 'fresh',
};

export function isAgentRole(value: string): value is AgentRole {
  return KNOWN_ROLES.has(value);
}

export function resolveSubagentRole(
  meta: AgentMeta | null | undefined,
  agentName?: string,
): AgentRole {
  if (meta?.role && isAgentRole(meta.role)) return meta.role;
  if (agentName) {
    const inferred = PRESET_ROLE_BY_NAME[agentName.toLowerCase()];
    if (inferred) return inferred;
  }
  return 'subtask';
}

export function resolveSubagentContextMode(
  meta: AgentMeta | null | undefined,
  role: AgentRole,
  explicit?: SubagentContextMode,
): SubagentContextMode {
  if (explicit === 'fork' || explicit === 'fresh') return explicit;
  const fromMeta = meta?.contextMode;
  if (fromMeta === 'fork' || fromMeta === 'fresh') return fromMeta;
  return DEFAULT_CONTEXT_MODE_BY_ROLE[role];
}
