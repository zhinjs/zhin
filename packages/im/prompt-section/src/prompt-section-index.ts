import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  OwnerCapabilityIndex,
  type OwnerCapabilityEntry,
} from '@zhin.js/feature-kit';
import type {
  AgentPromptSectionDefinition,
  PromptProfile,
} from './definition.js';

export interface PromptSectionDescriptor extends AgentPromptSectionDefinition {
  readonly owner: PluginId;
  readonly name: string;
  readonly qualifiedName: string;
  readonly source: string;
  readonly generation: number;
}

export class PromptSectionIndex {
  readonly $projection = 'zhin.prompt-section-index/1' as const;
  readonly #index: OwnerCapabilityIndex<AgentPromptSectionDefinition>;

  constructor(
    slots: readonly Readonly<CapabilitySlot<AgentPromptSectionDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    this.#index = new OwnerCapabilityIndex(slots, snapshot);
  }

  list(): readonly PromptSectionDescriptor[] {
    return this.#index.entries().map((entry) => toDescriptor(entry, this.snapshot.generation));
  }

  visible(requester: PluginId, profile: PromptProfile): readonly PromptSectionDescriptor[] {
    return Object.freeze(this.#index.visible(requester)
      .filter((entry) => entry.slot.definition.profiles.includes(profile))
      .map((entry) => toDescriptor(entry, this.snapshot.generation)));
  }
}

export function isPromptSectionIndex(value: unknown): value is PromptSectionIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.prompt-section-index/1';
}

function toDescriptor(
  entry: OwnerCapabilityEntry<AgentPromptSectionDefinition>,
  generation: number,
): PromptSectionDescriptor {
  return Object.freeze({
    ...entry.slot.definition,
    owner: entry.owner,
    name: entry.name,
    qualifiedName: entry.qualifiedName,
    source: entry.source,
    generation,
  });
}
