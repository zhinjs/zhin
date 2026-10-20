import { AsyncLocalStorage } from 'node:async_hooks';
import type { ResolvedAgentBinding } from '../config/types.js';

/** Immutable configuration attached to one Agent turn. */
export interface AgentTurnConfiguration {
  readonly activeBinding?: ResolvedAgentBinding;
  readonly bootstrapContext?: string;
}

const agentTurnStorage = new AsyncLocalStorage<AgentTurnConfiguration>();

/**
 * Runs work with its configuration isolated from concurrent turns. Runtime
 * setup remains mutable; per-message routing must use this context instead.
 */
export function runWithAgentTurnConfiguration<T>(
  configuration: AgentTurnConfiguration,
  fn: () => Promise<T>,
): Promise<T> {
  return agentTurnStorage.run(Object.freeze({ ...configuration }), fn);
}

export function getAgentTurnConfiguration(): AgentTurnConfiguration | undefined {
  return agentTurnStorage.getStore();
}
