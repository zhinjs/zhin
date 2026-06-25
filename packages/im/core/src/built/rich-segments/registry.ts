import type {
  OutboundRichSegmentPolicy,
  RichSegmentKindDefinition,
} from './types.js';

export class RichSegmentRegistry {
  readonly #kinds = new Map<string, RichSegmentKindDefinition>();

  register(definition: RichSegmentKindDefinition): void {
    if (this.#kinds.has(definition.kind)) {
      throw new Error(`Rich segment kind already registered: ${definition.kind}`);
    }
    if (!definition.modes.includes(definition.defaultMode)) {
      throw new Error(
        `Rich segment ${definition.kind}: defaultMode "${definition.defaultMode}" not in modes`,
      );
    }
    this.#kinds.set(definition.kind, definition);
  }

  has(kind: string): boolean {
    return this.#kinds.has(kind);
  }

  get(kind: string): RichSegmentKindDefinition | undefined {
    return this.#kinds.get(kind);
  }

  list(): RichSegmentKindDefinition[] {
    return [...this.#kinds.values()];
  }

  buildDefaultPolicy(): OutboundRichSegmentPolicy {
    const policy: OutboundRichSegmentPolicy = {};
    for (const def of this.#kinds.values()) {
      policy[def.kind] = def.defaultMode;
    }
    return policy;
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

  /** 测试隔离：清空后需重新 register builtins */
  clearForTests(): void {
    this.#kinds.clear();
  }
}

export const RICH_SEGMENT_FALLBACK_MODE = 'origin';

export const richSegmentRegistry = new RichSegmentRegistry();

export function registerRichSegmentKind(definition: RichSegmentKindDefinition): void {
  richSegmentRegistry.register(definition);
}
