/**
 * `ai.agent.*` switches retired by the config convergence review (#735).
 *
 * Each one is read by nothing at runtime, so removing it changes no
 * behaviour. They stay accepted for compatibility: startup logs a warning,
 * `zhin config check` reports them, and `zhin config check --fix` deletes
 * them. See docs/ai/default-behavior.md for the full switch inventory.
 */
export const DEPRECATED_AGENT_CONFIG_KEYS: Readonly<Record<string, string>> = Object.freeze({
  maxSkills: '已无效果：技能目录按渐进披露常驻名称和触发说明，不再按数量截断。',
  policyDenialStopAfter: '已无效果：被拒绝的调用由工具预算（toolBudget.failureStreakLimit / repeatLimit）处理。',
  deferredToolMaxResults: '已无效果：使用 deferredTools.discoverTopK。',
  taskExecApprovalMode: '已无效果：任务命令按 execApprovalMode / workerExecApprovalMode 审批。',
});

export interface DeprecatedAgentConfigKey {
  readonly key: string;
  readonly reason: string;
}

/** Deprecated keys present in an `ai.agent` section, in declaration order. */
export function findDeprecatedAgentConfigKeys(agent: unknown): DeprecatedAgentConfigKey[] {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return [];
  return Object.entries(DEPRECATED_AGENT_CONFIG_KEYS)
    .filter(([key]) => key in (agent as Record<string, unknown>))
    .map(([key, reason]) => ({ key, reason }));
}
