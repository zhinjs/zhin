/** Canonical roles of the optional Five-Agent workflow strategy. */
export type FiveAgentRole = 'planner' | 'researcher' | 'evaluator' | 'executor' | 'reviewer';

export const FIVE_AGENT_ROLES: readonly FiveAgentRole[] = Object.freeze([
  'planner',
  'researcher',
  'evaluator',
  'executor',
  'reviewer',
]);

export function isFiveAgentRole(value: unknown): value is FiveAgentRole {
  return typeof value === 'string'
    && (FIVE_AGENT_ROLES as readonly string[]).includes(value);
}
