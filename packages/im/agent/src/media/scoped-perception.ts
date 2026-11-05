import { createHash } from 'node:crypto';
import { type Model } from '@zhin.js/ai';
import type { ModelExecutionBundle, ModelExecutionCandidate, ModelExecutionScope } from '../model-runtime/types.js';
import { createLlmMediaPerceptionPort, resolvePerceptionConfig,
  type LlmMediaPerceptionOptions, type MediaPerceptionPort, type ResolvedPerceptionConfig, type PerceptionCacheEntry } from './perception.js';

export interface ScopedMediaPerceptionOptions {
  readonly cache?: LlmMediaPerceptionOptions['cache'];
  readonly cacheNamespace?: string;
  readonly scope: Pick<ModelExecutionScope, 'perception' | 'perceptionFallbacks'>;
  readonly settings?: Partial<Pick<ResolvedPerceptionConfig, 'kinds' | 'maxChars' | 'timeoutMs' | 'maxItemsPerTurn'>>;
  readonly resilience?: LlmMediaPerceptionOptions['resilience'];
  readonly timers?: LlmMediaPerceptionOptions['timers'];
  readonly onEvent?: LlmMediaPerceptionOptions['onEvent'];
}

/** Resolves only declared candidates from the captured operation, one at a time. */
class ScopedPerceptionRuntime {
  readonly #candidates = new Map<string, ModelExecutionCandidate>();
  readonly #models = new WeakMap<Model, ModelExecutionBundle>();
  readonly #resolved = new Map<string, ModelExecutionBundle>();

  constructor(bundles: readonly ModelExecutionCandidate[]) {
    for (const bundle of bundles) {
      const key = JSON.stringify([bundle.binding.profile.id, bundle.binding.model.id]);
      const previous = this.#candidates.get(key);
      if (previous && (previous.binding.profile.id !== bundle.binding.profile.id
        || previous.binding.profile.revision !== bundle.binding.profile.revision)) {
        throw new Error('Ambiguous acquired perception candidate');
      }
      this.#candidates.set(key, bundle);
    }
  }

  async model(alias: string, modelId: string): Promise<Model> {
    const candidate = this.#candidates.get(JSON.stringify([alias, modelId]));
    if (!candidate) throw new Error('Perception model is outside the acquired scope');
    const bundle = await candidate.resolve();
    const model = bundle.model;
    this.#models.set(model, bundle);
    this.#resolved.set(alias, bundle);
    return model;
  }

  resilience(profileId: string): Model['executionPolicy'] {
    return this.#resolved.get(profileId)?.model.executionPolicy;
  }

  complete(...args: Parameters<ModelExecutionBundle['completion']['complete']>): ReturnType<ModelExecutionBundle['completion']['complete']> {
    const bundle = this.#models.get(args[0]);
    if (!bundle) throw new Error('Perception model is outside the acquired scope');
    return bundle.completion.complete(...args);
  }

  completeSimple(...args: Parameters<ModelExecutionBundle['completion']['completeSimple']>): ReturnType<ModelExecutionBundle['completion']['completeSimple']> {
    const bundle = this.#models.get(args[0]);
    if (!bundle) throw new Error('Perception model is outside the acquired scope');
    return bundle.completion.completeSimple(...args);
  }
}

/** Preserves the existing ordered fallback/resilience/cache path for one immutable model scope. */
export function createScopedMediaPerceptionPort(options: ScopedMediaPerceptionOptions): MediaPerceptionPort | undefined {
  const primary = options.scope.perception;
  if (!primary) return undefined;
  const fallbacks = options.scope.perceptionFallbacks ?? [];
  const candidate = (bundle: ModelExecutionCandidate) => ({ provider: bundle.binding.profile.id, model: bundle.binding.model.id });
  const config = resolvePerceptionConfig({
    ...candidate(primary),
    fallbacks: fallbacks.map(candidate),
    // A caller may hold a full legacy config at runtime. Only non-routing
    // settings cross this boundary; provider/model/fallbacks belong to the lease.
    kinds: options.settings?.kinds,
    maxChars: options.settings?.maxChars,
    timeoutMs: options.settings?.timeoutMs,
    maxItemsPerTurn: options.settings?.maxItemsPerTurn,
  })!;
  return createLlmMediaPerceptionPort({
    cache: options.cache, cacheNamespace: options.cacheNamespace,
    runtime: new ScopedPerceptionRuntime([primary, ...fallbacks]), config,
    resilience: options.resilience, timers: options.timers, onEvent: options.onEvent,
  });
}

/** One generation retains the existing total cache limit, without mixing personal or model scopes. */
export function createScopedPerceptionFactory(): (options: Omit<ScopedMediaPerceptionOptions, 'cache' | 'cacheNamespace'> & { readonly sessionKey: string }) => MediaPerceptionPort | undefined {
  const cache = new Map<string, PerceptionCacheEntry>();
  return options => {
    const candidates = [options.scope.perception, ...(options.scope.perceptionFallbacks ?? [])].map(bundle => bundle ?
      [bundle.binding.account.ownerId, bundle.binding.account.id, bundle.binding.account.incarnation,
        bundle.binding.profile.id, bundle.binding.profile.revision, bundle.binding.model] : null);
    const cacheNamespace = createHash('sha256').update(JSON.stringify([options.sessionKey, candidates,
      options.settings?.kinds, options.settings?.maxChars, options.settings?.timeoutMs, options.settings?.maxItemsPerTurn])).digest('hex');
    return createScopedMediaPerceptionPort({ ...options, cache, cacheNamespace });
  };
}
