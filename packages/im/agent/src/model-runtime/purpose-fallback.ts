import {
  createFallbackCompletionPort, MODEL_FALLBACK_NOTICE, modelAvailability,
  type ModelAvailabilityRegistry, type ModelFallbackCandidate, type ModelFallbackEndpoint, type ModelFallbackEvent,
} from '@zhin.js/ai';
import {
  createProfileReference, providerPurposeSelections,
  type ExecutionBinding, type InferenceOperationScope, type LanguagePurpose, type ProviderSelectionSource,
} from '@zhin.js/ai/provider';
import { getLogger } from '@zhin.js/logger';
import { createInvocationCompletion, invocationModel } from './completion.js';
import type { ModelExecutionBundle } from './types.js';

const logger = getLogger('ai.model-runtime');

export type FallbackPurpose = Exclude<LanguagePurpose, 'perception'> | `agent:${string}`;

/** Collects fallback events of one operation and replays them to late observers (the trace starts later). */
export class ModelFallbackLog {
  readonly #events: ModelFallbackEvent[] = [];
  readonly #listeners = new Set<(event: ModelFallbackEvent) => void>();

  record = (event: ModelFallbackEvent): void => {
    this.#events.push(event);
    logger.warn(`${MODEL_FALLBACK_NOTICE}: purpose=${event.purpose} ${event.from.accountId}/${event.from.model} → `
      + `${event.to.accountId}/${event.to.model} reason=${event.reason} phase=${event.phase}`);
    for (const listener of this.#listeners) {
      try { listener(event); } catch { /* Observers never change the answer. */ }
    }
  };

  events(): readonly ModelFallbackEvent[] { return Object.freeze([...this.#events]); }

  /** Replays earlier events, then reports new ones until the returned function is called. */
  observe(listener: (event: ModelFallbackEvent) => void): () => void {
    for (const event of this.#events) {
      try { listener(event); } catch { /* Observers never change the answer. */ }
    }
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}

function endpoint(binding: ExecutionBinding): ModelFallbackEndpoint {
  return Object.freeze({ profileId: binding.profile.id, accountId: binding.account.id, model: binding.model.id });
}

async function bundle(scope: InferenceOperationScope, binding: ExecutionBinding, purpose: FallbackPurpose): Promise<ModelExecutionBundle> {
  return Object.freeze({ binding, model: invocationModel(binding, await scope.describeModel({ purpose,
    profile: createProfileReference({ binding, kind: 'language' }) })),
    completion: createInvocationCompletion({ binding, client: scope.client, purpose }) });
}

/**
 * The model of one language purpose with its configured fallbacks (#1250 chat-purpose-no-fallback).
 *
 * `primary` is the binding the purpose resolves to. Its own layer's ordered fallbacks follow it.
 * A primary (or fallback) that is currently skipped because of an earlier quota / billing / auth
 * failure is passed over at selection time; the returned bundle is the model that will answer,
 * and its completion port switches to the next fallback when a request fails with one of those
 * classes. Fallback Profiles are validated only when they are about to be used.
 */
export async function resolvePurposeExecution(input: Readonly<{
  scope: InferenceOperationScope;
  purpose: FallbackPurpose;
  primary: ExecutionBinding;
  registry?: ModelAvailabilityRegistry;
  onFallback?: (event: ModelFallbackEvent) => void;
}>): Promise<ModelExecutionBundle> {
  const { scope, purpose, primary } = input;
  const registry = input.registry ?? modelAvailability;
  const selections = providerPurposeSelections({ graph: scope.graph, context: scope.context, purpose });
  // Only the chain the primary belongs to (an explicit Profile or session choice has none).
  const chain = selections[0]?.id === primary.profile.id ? selections.slice(1) : [];
  const candidates: ModelFallbackCandidate[] = [];
  for (const { id, source } of chain) {
    const profile = scope.graph.profiles[id];
    const account = profile && scope.graph.accounts[profile.accountId];
    const service = account && scope.graph.services[account.serviceId];
    const model = service?.models[profile.model];
    if (!profile || !account || !service || !model) continue;
    const declaration: ExecutionBinding = Object.freeze({ graphRevision: scope.graph.revision, profile, account, service, model,
      ...(source ? { source: source as ProviderSelectionSource } : {}) });
    let pending: Promise<ModelExecutionBundle> | undefined;
    const resolve = () => pending ??= (async () => {
      scope.signal.throwIfAborted();
      const binding = await scope.resolve({ kind: 'language', purpose,
        profile: createProfileReference({ binding: declaration, kind: 'language' }) });
      return bundle(scope, { ...binding, ...(source ? { source } : {}) }, purpose);
    })();
    candidates.push(Object.freeze({ endpoint: endpoint(declaration),
      resolve: async () => { const resolved = await resolve(); return { model: resolved.model, completion: resolved.completion }; },
      bundle: resolve }) as ModelFallbackCandidate & { bundle: () => Promise<ModelExecutionBundle> });
  }
  type Resolvable = ModelFallbackCandidate & { bundle: () => Promise<ModelExecutionBundle> };
  let chosen: ModelExecutionBundle | undefined;
  let rest: readonly ModelFallbackCandidate[] = candidates;
  const skipped = candidates.length ? registry.unavailable(primary.account.id, primary.model.id) : undefined;
  if (skipped) {
    for (const [index, candidate] of candidates.entries()) {
      if (registry.unavailable(candidate.endpoint.accountId, candidate.endpoint.model)) continue;
      try {
        chosen = await (candidate as Resolvable).bundle();
      } catch (error) {
        logger.warn(`fallback ${candidate.endpoint.profileId} for ${purpose} is unusable: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      rest = candidates.slice(index + 1);
      const event: ModelFallbackEvent = Object.freeze({ purpose, from: endpoint(primary), to: candidate.endpoint,
        reason: skipped.reason, phase: 'selection', at: registry.now(), fromUntil: skipped.until, notice: MODEL_FALLBACK_NOTICE });
      registry.recordFallback(event);
      input.onFallback?.(event);
      break;
    }
    // Every candidate is skipped or unusable: try the primary anyway (its quota may be back early).
  }
  chosen ??= await bundle(scope, primary, purpose);
  if (!rest.length) return chosen;
  return Object.freeze({ ...chosen, completion: createFallbackCompletionPort({
    purpose, registry, fallbacks: rest, onFallback: input.onFallback,
    primary: { endpoint: endpoint(chosen.binding), model: chosen.model, completion: chosen.completion },
    onCandidateError: (target, error) => logger.warn(`fallback ${target.profileId} for ${purpose} is unusable: ${error instanceof Error ? error.message : String(error)}`),
  }) });
}

/** Trace shape of one fallback switch (`TurnTraceModelFallback`). */
export function traceModelFallback(event: ModelFallbackEvent): Readonly<{
  purpose: string; from_profile_id: string; from_account_id: string; from_model: string;
  to_profile_id: string; to_account_id: string; to_model: string; reason: string;
  phase: 'selection' | 'request'; from_until?: number; notice: string;
}> {
  return Object.freeze({ purpose: event.purpose,
    from_profile_id: event.from.profileId, from_account_id: event.from.accountId, from_model: event.from.model,
    to_profile_id: event.to.profileId, to_account_id: event.to.accountId, to_model: event.to.model,
    reason: event.reason, phase: event.phase, ...(event.fromUntil !== undefined ? { from_until: event.fromUntil } : {}),
    notice: event.notice });
}
