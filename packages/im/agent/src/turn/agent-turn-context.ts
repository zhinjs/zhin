import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelExecutionScope } from '../model-runtime/types.js';
import type { ResolvedAgentBinding } from '../config/types.js';

/** Immutable configuration attached to one Agent turn. */
export interface AgentTurnConfiguration {
  readonly mediaPerception?: import('../media/perception.js').MediaPerceptionPort;
  readonly models?: ModelExecutionScope;
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
  const binding = configuration.activeBinding ? freezeBinding(structuredClone(configuration.activeBinding)) : undefined;
  return agentTurnStorage.run(Object.freeze({ ...configuration, activeBinding: binding }), fn);
}

export function getAgentTurnConfiguration(): AgentTurnConfiguration | undefined {
  return agentTurnStorage.getStore();
}

function freezeBinding<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const part of Object.values(value)) freezeBinding(part);
    Object.freeze(value);
  }
  return value;
}
