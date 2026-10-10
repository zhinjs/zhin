import { AsyncLocalStorage } from 'node:async_hooks';
import { createToken, childPluginId, type PluginId, type RuntimeSnapshot, type Scope } from '@zhin.js/plugin-runtime';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentDecisionConfig, AgentDecisionRuntime, DecisionObservation } from '../decision/types.js';
import { DECISION_TASKS } from '../decision/config.js';

/** Provided locally by an optional service Plugin; never a process-wide registry. */
export interface AgentDecisionProviderResource {
  readonly owner: PluginId;
  readonly provider: DecisionProvider;
}

export const decisionProviderToken = createToken<AgentDecisionProviderResource>('zhin.agent.decision-provider');
export const agentDecisionConfigToken = createToken<AgentDecisionConfig>('zhin.agent.decision-config');

/** Preserve declaration ownership even when Scope snapshots include inherited resources. */
export function provideAgentDecisionProvider(resources: Scope, provider: DecisionProvider): void {
  resources.provide(decisionProviderToken, Object.freeze({ owner: resources.owner, provider }));
}

/** Resolve the configured exact owner from the operation's held generation. */
export function resolveAgentDecisionRuntime(
  snapshot: RuntimeSnapshot,
  observe?: (observation: DecisionObservation) => void,
): AgentDecisionRuntime | undefined {
  const config = snapshot.resources.get(snapshot.root)?.get(agentDecisionConfigToken.id) as AgentDecisionConfig | undefined;
  if (!config || !DECISION_TASKS.some(task => config[task] && config[task]!.mode !== 'off')) return undefined;
  const owner = config.provider.split('/').slice(1).reduce(childPluginId, snapshot.root);
  const resource = snapshot.resources.get(owner)?.get(decisionProviderToken.id) as AgentDecisionProviderResource | undefined;
  if (!snapshot.tree.has(owner) || resource?.owner !== owner || typeof resource.provider?.evaluate !== 'function') {
    throw new Error(`ai.decisions.provider ${config.provider} does not provide an enabled DecisionProvider`);
  }
  return Object.freeze({ provider: resource.provider, config, ...(observe ? { observe } : {}) });
}

interface AgentDecisionTurnContext {
  readonly snapshot: RuntimeSnapshot;
  readonly turnId: string;
  readonly disabled: boolean;
  readonly runtime?: AgentDecisionRuntime;
  readonly observations: DecisionObservation[];
}

// This authority belongs to the runtime, separately from caller-supplied turn configuration.
const decisionTurnStorage = new AsyncLocalStorage<AgentDecisionTurnContext>();

export function getAgentTurnDecisionRuntime(): AgentDecisionRuntime | undefined {
  return decisionTurnStorage.getStore()?.runtime;
}

export function drainAgentTurnDecisionObservations(): readonly DecisionObservation[] {
  return decisionTurnStorage.getStore()?.observations.splice(0) ?? [];
}

/** Ingress selection, approval, and native tools share one held-generation decision context. */
export function runWithAgentDecisionTurn<T>(
  snapshot: RuntimeSnapshot,
  turnId: string,
  run: (runtime: AgentDecisionRuntime | undefined) => Promise<T>,
  options: { readonly disabled?: boolean; readonly observe?: (observation: DecisionObservation) => void } = {},
): Promise<T> {
  const current = decisionTurnStorage.getStore();
  const disabled = options.disabled ?? false;
  if (current?.snapshot === snapshot && current.turnId === turnId && current.disabled === disabled) return run(current.runtime);
  const observations: DecisionObservation[] = [];
  const runtime = disabled ? undefined : resolveAgentDecisionRuntime(snapshot, observation => {
    observations.push(observation);
    try { options.observe?.(observation); } catch { /* diagnostics do not change authority */ }
  });
  return decisionTurnStorage.run({ snapshot, turnId, disabled, runtime, observations }, () => run(runtime));
}
