import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  OwnerCapabilityIndex,
  type OwnerCapabilityEntry,
} from '@zhin.js/feature-kit';
import type { SkillDefinition } from './definition.js';

export interface SkillDescriptor extends SkillDefinition {
  readonly owner: PluginId;
  readonly qualifiedName: string;
  readonly source: string;
}

export class SkillIndex {
  readonly #index: OwnerCapabilityIndex<SkillDefinition>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<SkillDefinition>>[],
    snapshot: RuntimeSnapshot,
  ) {
    this.#index = new OwnerCapabilityIndex(slots, snapshot);
  }

  list(): readonly SkillDescriptor[] {
    return this.#index.entries().map(toDescriptor);
  }

  visible(requester: PluginId): readonly SkillDescriptor[] {
    return this.#index.visible(requester).map(toDescriptor);
  }

  get(requester: PluginId, name: string): SkillDescriptor | undefined {
    const entry = this.#index.resolve(requester, name);
    return entry ? toDescriptor(entry) : undefined;
  }
}

function toDescriptor(entry: OwnerCapabilityEntry<SkillDefinition>): SkillDescriptor {
  return Object.freeze({
    ...entry.slot.definition,
    owner: entry.owner,
    qualifiedName: entry.qualifiedName,
    source: entry.source,
  });
}
