/** ADR 0030 — permission.task glob rules for spawn_task agent visibility. */

export type PermissionTaskAction = 'allow' | 'deny';

export type PermissionTaskRules = Record<string, PermissionTaskAction>;

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesPermissionTaskPattern(pattern: string, agentName: string): boolean {
  if (pattern === '*') return true;
  return globToRegExp(pattern).test(agentName);
}

/** Last matching rule wins; default deny when rules are configured. */
export function evaluatePermissionTask(
  rules: PermissionTaskRules | undefined,
  agentName: string,
): PermissionTaskAction {
  if (!rules || Object.keys(rules).length === 0) return 'allow';
  let action: PermissionTaskAction = 'deny';
  for (const [pattern, rule] of Object.entries(rules)) {
    if (matchesPermissionTaskPattern(pattern, agentName)) {
      action = rule;
    }
  }
  return action;
}

export function filterAgentsForSpawnDescription(
  agentNames: string[],
  rules: PermissionTaskRules | undefined,
): string[] {
  return agentNames.filter((name) => evaluatePermissionTask(rules, name) !== 'deny');
}

export function assertSpawnAgentAllowed(
  agentName: string | undefined,
  rules: PermissionTaskRules | undefined,
): string | undefined {
  if (!agentName?.trim()) return undefined;
  if (evaluatePermissionTask(rules, agentName.trim()) === 'deny') {
    return `Sub-agent type "${agentName.trim()}" is not allowed (permission.task).`;
  }
  return undefined;
}
