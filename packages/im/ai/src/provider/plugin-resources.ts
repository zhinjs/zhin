import { createToken, type PluginId, type RuntimeSnapshot, type Scope, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { ProviderDefinition, ProviderDriverResolver } from './driver.js';
import { ProviderError, type InferenceClient } from './types.js';
export * from './lazy-client.js';
export * from './usage.js';

export interface ProvidedAiProvider {
  readonly owner: PluginId;
  readonly definition: ProviderDefinition<unknown, unknown>;
}

/** Declarations only; no accounts, mutable credentials or process-wide registry. */
export const aiProviderDefinitionsToken = createToken<readonly ProvidedAiProvider[]>('zhin.ai.provider-definitions');

/** Installed only on an actual operation with its already bound principal. */
export const aiInferenceClientToken = createToken<InferenceClient>('zhin.ai.inference-client');

export function provideAiProviders(
  resources: Scope,
  definitions: readonly ProviderDefinition<unknown, unknown>[],
): void {
  const names = new Set<string>();
  const entries = definitions.map(definition => {
    if (!definition.id || names.has(definition.id)) throw new Error('Duplicate or empty AI Provider definition');
    names.add(definition.id);
    return Object.freeze({ owner: resources.owner, definition });
  });
  resources.provide(aiProviderDefinitionsToken, Object.freeze(entries));
}

/** Pure projection of the supplied held snapshot; inherited declarations are not new owners. */
export function listSnapshotAiProviders(snapshot: RuntimeSnapshot): readonly ProvidedAiProvider[] {
  const result: ProvidedAiProvider[] = [];
  for (const [owner, resources] of snapshot.resources) {
    if (!snapshot.tree.has(owner)) continue;
    const entries = resources.get(aiProviderDefinitionsToken.id) as readonly ProvidedAiProvider[] | undefined;
    for (const entry of entries ?? []) if (entry.owner === owner) result.push(entry);
  }
  return Object.freeze(result);
}

export function describeSnapshotAiProvider(input: {
  readonly snapshot: RuntimeSnapshot;
  readonly id: string;
  readonly owner?: string;
}): ProvidedAiProvider {
  const matches = listSnapshotAiProviders(input.snapshot).filter(entry =>
    entry.definition.id === input.id && (input.owner === undefined || entry.owner === input.owner));
  const matched = matches[0];
  if (!matched) throw new ProviderError('driver-unavailable');
  if (matches.length !== 1) throw new Error('AI Provider driver name is ambiguous; select an exact owner');
  return matched;
}

export interface SnapshotProviderResolverOptions {
  readonly snapshots: SnapshotReader;
  /** The held operation generation, never a lookup of the latest snapshot. */
  readonly lease: SnapshotLease;
}

export function createSnapshotProviderResolver(options: SnapshotProviderResolverOptions): ProviderDriverResolver {
  return {
    async acquire({ service, signal }) {
      signal.throwIfAborted();
      const lease = options.snapshots.retain(options.lease);
      try {
        const snapshot = lease.value;
        const owner = service.driver.owner as PluginId;
        if (!snapshot.tree.has(owner)) throw new ProviderError('driver-unavailable');
        const entries = snapshot.resources.get(owner)?.get(aiProviderDefinitionsToken.id) as readonly ProvidedAiProvider[] | undefined;
        const provided = entries?.find(entry => entry.owner === owner && entry.definition.id === service.driver.id);
        if (!provided) throw new ProviderError('driver-unavailable');
        if (provided.definition.contractVersion !== service.driver.contractVersion) throw new ProviderError('driver-contract-mismatch');
        let released = false;
        return {
          definition: provided.definition,
          reference: Object.freeze({ ...service.driver }),
          release() {
            if (released) return;
            released = true;
            lease.release();
          },
        };
      } catch (error) {
        lease.release();
        throw error;
      }
    },
  };
}
