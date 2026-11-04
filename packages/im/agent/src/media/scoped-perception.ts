import { createHash } from 'node:crypto';
import { type Model } from '@zhin.js/ai';
import type { ModelExecutionBundle, ModelExecutionScope } from '../model-runtime/types.js';
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

/** Routes only already acquired models; it cannot discover or construct another provider. */
class ScopedPerceptionRuntime {
  readonly #candidates = new Map<string, ModelExecutionBundle>();
  readonly #models = new WeakMap<Model, ModelExecutionBundle>();

  constructor(bundles: readonly ModelExecutionBundle[]) {
    for (const bundle of bundles) {
      const key = JSON.stringify([bundle.binding.profile.id, bundle.model.id]);
      const previous = this.#candidates.get(key);
      if (previous && (previous.binding.profile.id !== bundle.binding.profile.id
        || previous.binding.profile.revision !== bundle.binding.profile.revision)) {
        throw new Error('Ambiguous acquired perception candidate');
      }
      this.#candidates.set(key, bundle);
    }
  }

  model(alias: string, modelId: string): Model {
    const bundle = this.#candidates.get(JSON.stringify([alias, modelId]));
    if (!bundle) throw new Error('Perception model is outside the acquired scope');
    const model = bundle.model;
    this.#models.set(model, bundle);
    return model;
  }

  resilience(profileId: string): Model['executionPolicy'] {
    return [...this.#candidates.values()].find(bundle => bundle.binding.profile.id === profileId)?.model.executionPolicy;
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
  const candidate = (bundle: ModelExecutionBundle) => ({ provider: bundle.binding.profile.id, model: bundle.model.id });
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
