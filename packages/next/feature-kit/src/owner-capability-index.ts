import type {
  CapabilitySlot,
  PluginId,
  RuntimeSnapshot,
} from '@zhin.js/next-kernel';

export interface OwnerCapabilityEntry<TDefinition> {
  readonly owner: PluginId;
  readonly name: string;
  readonly qualifiedName: string;
  readonly source: string;
  readonly slot: Readonly<CapabilitySlot<TDefinition>>;
}

/** Provides deterministic owner inheritance without assigning domain semantics. */
export class OwnerCapabilityIndex<TDefinition> {
  readonly #entries: readonly OwnerCapabilityEntry<TDefinition>[];
  readonly #byOwnerAndName = new Map<string, OwnerCapabilityEntry<TDefinition>>();

  constructor(
    slots: readonly Readonly<CapabilitySlot<TDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    this.#entries = Object.freeze(slots.map((slot) => {
      const key = ownerKey(slot.owner, slot.localName);
      if (this.#byOwnerAndName.has(key)) {
        throw new Error(`Duplicate owner Capability ${slot.localName} for ${slot.owner}`);
      }
      const entry = Object.freeze({
        owner: slot.owner,
        name: slot.localName,
        qualifiedName: qualifyCapabilityName(snapshot, slot.owner, slot.localName),
        source: slot.source,
        slot,
      });
      this.#byOwnerAndName.set(key, entry);
      return entry;
    }).sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName)));
  }

  entries(): readonly OwnerCapabilityEntry<TDefinition>[] {
    return this.#entries;
  }

  resolve(requester: PluginId, name: string): OwnerCapabilityEntry<TDefinition> | undefined {
    let owner: PluginId | undefined = requester;
    while (owner) {
      const entry = this.#byOwnerAndName.get(ownerKey(owner, name));
      if (entry) return entry;
      owner = this.snapshot.tree.get(owner)?.parent;
    }
    return undefined;
  }

  visible(requester: PluginId): readonly OwnerCapabilityEntry<TDefinition>[] {
    if (!this.snapshot.tree.has(requester)) throw new Error(`Unknown Capability requester: ${requester}`);
    const names = new Set<string>();
    const result: OwnerCapabilityEntry<TDefinition>[] = [];
    let owner: PluginId | undefined = requester;
    while (owner) {
      for (const entry of this.#entries) {
        if (entry.owner !== owner || names.has(entry.name)) continue;
        names.add(entry.name);
        result.push(entry);
      }
      owner = this.snapshot.tree.get(owner)?.parent;
    }
    return Object.freeze(result.sort((left, right) => left.name.localeCompare(right.name)));
  }
}

export function qualifyCapabilityName(
  snapshot: RuntimeSnapshot,
  owner: PluginId,
  localName: string,
): string {
  const ownerSegments = owner === snapshot.root
    ? []
    : owner.slice(`${snapshot.root}/`.length).split('/');
  return [...ownerSegments, ...localName.split('/')].join('__');
}

function ownerKey(owner: PluginId, name: string): string {
  return `${owner}\0${name}`;
}
