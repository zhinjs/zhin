import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { createProfileReference, type InferenceGraphSnapshot } from '@zhin.js/ai/provider';
import type { DecisionProvider } from '@zhin.js/ai';
import type { ModelExecutionScope } from '../model-runtime/types.js';
import type { AgentDecisionRuntime, DecisionObservation, DecisionTask } from '../decision/types.js';
import { DECISION_TASKS } from '../decision/config.js';

export type DecisionModelScope = Pick<ModelExecutionScope, 'graph' | 'inference' | 'resolve'>;

/** Task selection is a policy over the same operation graph, never a second Provider registry. */
export function resolveAgentDecisionRuntime(
  models: DecisionModelScope,
  observe?: (observation: DecisionObservation) => void,
): AgentDecisionRuntime | undefined {
  const config = models.graph.purposes.decisions;
  if (!config || !DECISION_TASKS.some(task => config[task]?.mode !== undefined && config[task]?.mode !== 'off')) return undefined;
  const providers = new Map<DecisionTask, DecisionProvider>();
  return Object.freeze({ config,
    forTask(task: DecisionTask): DecisionProvider | undefined {
      const policy = config[task];
      if (!policy || policy.mode === 'off') return undefined;
      let provider = providers.get(task);
      if (!provider) {
        const purpose = `decision:${task}` as const;
        const implementation: DecisionProvider = { evaluate: async (request, options) => {
          const binding = await models.resolve({ kind: 'decision', purpose });
          const profile = createProfileReference({ binding, kind: 'decision' });
          if (request.model !== undefined && request.model !== binding.model.id) throw new Error('Decision model is fixed by the selected Profile');
          return models.inference.evaluate({ profile, state: request.state, questions: request.questions,
            signal: options.signal, timeoutMs: options.timeoutMs });
        } };
        provider = Object.freeze(implementation);
        providers.set(task, provider);
      }
      return provider;
    }, ...(observe ? { observe } : {}),
  });
}

interface AgentDecisionTurnContext {
  readonly snapshot?: RuntimeSnapshot;
  readonly turnId: string;
  readonly disabled: boolean;
  readonly runtime?: AgentDecisionRuntime;
  readonly models?: DecisionModelScope;
  readonly inferenceSnapshot?: InferenceGraphSnapshot;
  readonly observations: DecisionObservation[];
}

// This authority belongs to the runtime, separately from caller-supplied turn configuration.
const decisionTurnStorage = new AsyncLocalStorage<AgentDecisionTurnContext>();

export function getAgentTurnDecisionRuntime(): AgentDecisionRuntime | undefined {
  return decisionTurnStorage.getStore()?.runtime;
}

/** Delegated work keeps its origin's policy restriction, but never its client. */
export function isAgentTurnDecisionDisabled(): boolean {
  return decisionTurnStorage.getStore()?.disabled ?? false;
}

/** Opaque capture for the same root, turn, session and held generation. */
export function getAgentTurnInferenceSnapshot(): InferenceGraphSnapshot | undefined {
  return decisionTurnStorage.getStore()?.inferenceSnapshot;
}

export function drainAgentTurnDecisionObservations(): readonly DecisionObservation[] {
  return decisionTurnStorage.getStore()?.observations.splice(0) ?? [];
}

/** Ingress selection, approval, and native tools share one held-generation decision context. */
export function runWithAgentDecisionTurn<T>(
  options: { readonly snapshot?: RuntimeSnapshot; readonly turnId: string; readonly models?: DecisionModelScope;
    readonly inferenceSnapshot?: InferenceGraphSnapshot;
    readonly disabled?: boolean; readonly observe?: (observation: DecisionObservation) => void },
  run: (runtime: AgentDecisionRuntime | undefined) => Promise<T>,
): Promise<T> {
  const { snapshot, turnId, models } = options;
  const current = decisionTurnStorage.getStore();
  const disabled = options.disabled ?? false;
  if (current && current.snapshot === snapshot && current.turnId === turnId && current.disabled === disabled && current.models === models
    && current.inferenceSnapshot === options.inferenceSnapshot) return run(current.runtime);
  const observations: DecisionObservation[] = [];
  const runtime = disabled || !models ? undefined : resolveAgentDecisionRuntime(models, observation => {
    observations.push(observation);
    try { options.observe?.(observation); } catch { /* diagnostics do not change authority */ }
  });
  return decisionTurnStorage.run({ snapshot, turnId, models, inferenceSnapshot: options.inferenceSnapshot, disabled, runtime, observations }, () => run(runtime));
}
