import {
  createCapabilitySlot,
  type CapabilitySlot,
  type PluginId,
} from '@zhin.js/next-kernel';
import type {
  DiscoveryHost,
  FeatureProvider,
  ValidationContext,
} from './provider.js';

export interface CapabilityRoot {
  readonly owner: PluginId;
  readonly packageRoot: string;
}

export class DiscoveryConflictError extends Error {
  constructor(readonly source: string, readonly localName: string) {
    super(`Duplicate capability ${localName} discovered from ${source}`);
    this.name = 'DiscoveryConflictError';
  }
}

export class FeatureDiscovery {
  constructor(private readonly host: DiscoveryHost) {}

  async discover<TDefinition>(
    provider: FeatureProvider<TDefinition, unknown>,
    roots: readonly CapabilityRoot[],
  ): Promise<readonly Readonly<CapabilitySlot<TDefinition>>[]> {
    const slots: CapabilitySlot<TDefinition>[] = [];
    const identities = new Set<string>();
    const sources = new Map<string, string>();

    for (const root of roots) {
      const context = { ...root, host: this.host };
      for (const convention of provider.authoring.conventions) {
        for await (const discovered of convention.discover(context)) {
          const identity = `${root.owner}\0${discovered.localName}`;
          // One package source may back multiple mounted Plugin instances.
          // Source conflicts are therefore owner-scoped, not path-global.
          const sourceIdentity = `${root.owner}\0${discovered.source}`;
          if (identities.has(identity) || sources.has(sourceIdentity)) {
            throw new DiscoveryConflictError(
              discovered.source,
              discovered.localName,
            );
          }
          const validation: ValidationContext = {
            owner: root.owner,
            feature: provider.id,
            localName: discovered.localName,
            source: discovered.source,
          };
          const loaded = await convention.load(discovered, context);
          const definition = provider.authoring.validate(loaded, validation);
          const slot = createCapabilitySlot({
            owner: root.owner,
            feature: provider.id,
            localName: discovered.localName,
            source: discovered.source,
            definition,
          });
          identities.add(identity);
          sources.set(sourceIdentity, identity);
          slots.push(slot);
        }
      }
    }
    return slots;
  }
}
