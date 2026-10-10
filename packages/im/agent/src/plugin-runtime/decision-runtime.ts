import { createToken, childPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { DecisionProvider } from '@zhin.js/ai';
import type { AgentDecisionConfig, AgentDecisionRuntime, DecisionObservation } from '../decision/types.js';
import { DECISION_TASKS } from '../decision/config.js';

/** Provided locally by an optional service Plugin; never a process-wide registry. */
export const decisionProviderToken = createToken<DecisionProvider>('zhin.agent.decision-provider');
export const agentDecisionConfigToken = createToken<AgentDecisionConfig>('zhin.agent.decision-config');

/** Resolve the configured exact owner from the operation's held generation. */
export function resolveAgentDecisionRuntime(
  snapshot: RuntimeSnapshot,
  observe?: (observation: DecisionObservation) => void,
): AgentDecisionRuntime | undefined {
  const config = snapshot.resources.get(snapshot.root)?.get(agentDecisionConfigToken.id) as AgentDecisionConfig | undefined;
  if (!config || !DECISION_TASKS.some(task => config[task] && config[task]!.mode !== 'off')) return undefined;
  const owner = config.provider.split('/').slice(1).reduce(childPluginId, snapshot.root);
  const provider = snapshot.resources.get(owner)?.get(decisionProviderToken.id) as DecisionProvider | undefined;
  // An inherited parent service is not a declaration by the chosen owner.
  const parent = snapshot.tree.get(owner)?.parent;
  const inherited = parent ? snapshot.resources.get(parent)?.get(decisionProviderToken.id) : undefined;
  if (!snapshot.tree.has(owner) || !provider || typeof provider.evaluate !== 'function' || provider === inherited) {
    throw new Error(`ai.decisions.provider ${config.provider} does not provide an enabled DecisionProvider`);
  }
  return Object.freeze({ provider, config, ...(observe ? { observe } : {}) });
}
