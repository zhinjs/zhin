import type { LayoutManifest, LayoutSlot } from '@zhin.js/next-console-contract';
import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/next-kernel';
import {
  OwnerCapabilityIndex,
  type OwnerCapabilityEntry,
} from '@zhin.js/next-feature-kit';
import type { LayoutDefinition } from './definition.js';

export class LayoutIndex {
  readonly #index: OwnerCapabilityIndex<LayoutDefinition>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<LayoutDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    this.#index = new OwnerCapabilityIndex(slots, snapshot);
  }

  list(): readonly Readonly<LayoutManifest>[] {
    return this.#index.entries().map(toManifest);
  }

  resolve(owner: PluginId, slot: LayoutSlot): Readonly<LayoutManifest> | undefined {
    const entry = this.#index.resolve(owner, slot);
    return entry ? toManifest(entry) : undefined;
  }

  chain(owner: PluginId, slot: LayoutSlot): readonly Readonly<LayoutManifest>[] {
    const result: Readonly<LayoutManifest>[] = [];
    const seen = new Set<string>();
    let current: PluginId | undefined = owner;
    while (current) {
      const entry = this.#index.resolve(current, slot);
      if (!entry || seen.has(entry.owner)) break;
      seen.add(entry.owner);
      result.push(toManifest(entry));
      current = this.snapshot.tree.get(entry.owner)?.parent;
    }
    return Object.freeze(result);
  }
}

function toManifest(entry: OwnerCapabilityEntry<LayoutDefinition>): Readonly<LayoutManifest> {
  const definition = entry.slot.definition;
  return Object.freeze({
    id: entry.slot.id,
    owner: entry.owner,
    slot: definition.slot,
    source: entry.source,
    module: definition.module,
    hash: definition.hash,
  });
}
