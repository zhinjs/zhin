import type { AgentDecisionConfig, DecisionTask, DecisionTaskPolicy } from './types.js';

export const DECISION_TASKS = ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'] as const satisfies readonly DecisionTask[];

/** Validate before installing any optional remote decision service. */
export function normalizeAgentDecisionConfig(input: unknown): AgentDecisionConfig | undefined {
  if (input === undefined) return undefined;
  const config = object(input, 'ai.decisions');
  keys(config, DECISION_TASKS, 'purposes.decisions');
  const policies: Partial<Record<DecisionTask, DecisionTaskPolicy>> = {};
  for (const task of DECISION_TASKS) {
    if (config[task] === undefined) continue;
    const label = `ai.decisions.${task}`;
    const policy = object(config[task], label);
    keys(policy, ['profile', 'mode', 'timeoutMs', 'minConfidence', 'topK', 'maxCandidates', 'maxSelections'], label);
    if (typeof policy.mode !== 'string' || !['off', 'shadow', 'active'].includes(policy.mode)) {
      throw new TypeError(`${label}.mode must be off, shadow, or active`);
    }
    if (policy.mode !== 'off' && (typeof policy.profile !== 'string' || !policy.profile.trim())) throw new TypeError(`${label}.profile is required`);
    for (const field of ['timeoutMs', 'topK', 'maxCandidates', 'maxSelections']) {
      if (policy[field] !== undefined && (!Number.isSafeInteger(policy[field]) || Number(policy[field]) <= 0)) {
        throw new TypeError(`${label}.${field} must be a positive safe integer`);
      }
    }
    if (policy.timeoutMs !== undefined && Number(policy.timeoutMs) > 2_147_483_647) {
      throw new TypeError(`${label}.timeoutMs exceeds the Node timer limit`);
    }
    if (policy.minConfidence !== undefined && (typeof policy.minConfidence !== 'number'
      || !Number.isFinite(policy.minConfidence) || policy.minConfidence < 0 || policy.minConfidence > 1)) {
      throw new TypeError(`${label}.minConfidence must be between 0 and 1`);
    }
    policies[task] = Object.freeze({ ...policy }) as unknown as DecisionTaskPolicy;
  }
  return Object.freeze(policies);
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function keys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError(`${label} contains an unknown field`);
}
