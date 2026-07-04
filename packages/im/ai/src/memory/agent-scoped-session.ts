/**
 * Agent memory isolation scoping (independent of legacy ChatMessage sessions).
 */

export type AgentMemoryScope = 'user' | 'session' | 'agent';

/**
 * Resolve a session ID scoped by agent memory isolation policy.
 */
export function resolveAgentScopedSessionId(
  baseSessionId: string,
  agentName: string | undefined,
  memoryScope: AgentMemoryScope = 'session',
): string {
  switch (memoryScope) {
    case 'agent':
      return agentName ? `agent:${agentName}:${baseSessionId}` : baseSessionId;
    case 'user': {
      const parts = baseSessionId.split(':');
      if (parts.length >= 2) {
        return `user:${parts[0]}:${parts[1]}:${parts[parts.length - 1]}`;
      }
      return `user:${baseSessionId}`;
    }
    case 'session':
    default:
      return baseSessionId;
  }
}
