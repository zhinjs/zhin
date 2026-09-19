import type {
  OutboundRichSegmentPolicy,
  RichSegmentKindDefinition,
} from './types.js';

export class RichSegmentRegistry {
  readonly #kinds = new Map<string, RichSegmentKindDefinition>();

  constructor(definitions: readonly RichSegmentKindDefinition[]) {
    for (const definition of definitions) {
      if (this.#kinds.has(definition.kind)) {
        throw new Error(`Duplicate rich segment kind: ${definition.kind}`);
      }
      if (!definition.modes.includes(definition.defaultMode)) {
        throw new Error(
          `Rich segment ${definition.kind}: defaultMode "${definition.defaultMode}" not in modes`,
        );
      }
      this.#kinds.set(definition.kind, freezeDefinition(definition));
    }
  }

  has(kind: string): boolean {
    return this.#kinds.has(kind);
  }

  get(kind: string): RichSegmentKindDefinition | undefined {
    return this.#kinds.get(kind);
  }

  list(): readonly RichSegmentKindDefinition[] {
    return Object.freeze([...this.#kinds.values()]);
  }

  buildDefaultPolicy(): OutboundRichSegmentPolicy {
    const policy: OutboundRichSegmentPolicy = {};
    for (const def of this.#kinds.values()) {
      policy[def.kind] = def.defaultMode;
    }
    return Object.freeze(policy);
  }

  resolveMode(policy: OutboundRichSegmentPolicy, kind: string): string {
    const def = this.#kinds.get(kind);
    const requested = policy[kind] ?? def?.defaultMode ?? RICH_SEGMENT_FALLBACK_MODE;
    if (def && !def.modes.includes(requested)) {
      return def.defaultMode;
    }
    return requested;
  }

  wrap(kind: string, data: Record<string, unknown>) {
    const def = this.#kinds.get(kind);
    if (!def) {
      throw new Error(`Unknown rich segment kind: ${kind}`);
    }
    return def.wrap(data);
  }

}

export const RICH_SEGMENT_FALLBACK_MODE = 'origin';

function freezeDefinition(
  definition: RichSegmentKindDefinition,
): Readonly<RichSegmentKindDefinition> {
  return Object.freeze({
    ...definition,
    modes: Object.freeze([...definition.modes]),
  });
}
