import type { FeatureId } from '@zhin.js/plugin-runtime';
import type { FeatureProvider } from './provider.js';

export class FeatureConflictError extends Error {
  constructor(readonly feature: FeatureId) {
    super(`Conflicting Feature provider: ${feature}`);
    this.name = 'FeatureConflictError';
  }
}

export class FeatureCatalog {
  readonly #providers = new Map<FeatureId, FeatureProvider>();

  add(provider: FeatureProvider): void {
    const previous = this.#providers.get(provider.id);
    if (previous && previous !== provider) {
      throw new FeatureConflictError(provider.id);
    }
    this.#providers.set(provider.id, provider);
  }

  get(id: FeatureId): FeatureProvider {
    const provider = this.#providers.get(id);
    if (!provider) throw new Error(`Missing Feature provider: ${id}`);
    return provider;
  }

  values(): readonly FeatureProvider[] {
    return [...this.#providers.values()];
  }
}
