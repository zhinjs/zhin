import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import type {
  MiddlewareContext,
  MiddlewareDefinition,
  MiddlewareNext,
  MiddlewarePhase,
  MiddlewareTarget,
} from './definition.js';

export interface MiddlewareDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly phase: MiddlewarePhase;
  readonly target: MiddlewareTarget;
  readonly order: number;
}

interface MiddlewareRecord extends MiddlewareDescriptor {
  readonly slot: Readonly<CapabilitySlot<MiddlewareDefinition>>;
}

export class MiddlewareIndex {
  readonly $projection = 'zhin.middleware-index/1' as const;
  readonly #records: readonly MiddlewareRecord[];

  constructor(
    slots: readonly Readonly<CapabilitySlot<MiddlewareDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {
    const topology = topologyOrder(snapshot);
    this.#records = Object.freeze(slots.map((slot) => Object.freeze({
      owner: slot.owner,
      name: slot.localName,
      source: slot.source,
      phase: slot.definition.phase,
      target: slot.definition.target,
      order: slot.definition.order,
      slot,
    })).sort((left, right) => compareMiddleware(left, right, topology)));
  }

  list(): readonly MiddlewareDescriptor[] {
    return this.#records.map(({ slot: _slot, ...descriptor }) => descriptor);
  }

  async run<TInput>(
    input: TInput,
    terminal: MiddlewareNext = async () => undefined,
    target: MiddlewareTarget = 'inbound',
  ): Promise<void> {
    const records = this.#records.filter((record) => record.target === target);
    let cursor = -1;
    const dispatch = async (index: number): Promise<void> => {
      if (index <= cursor) throw new Error('Middleware next() called more than once');
      cursor = index;
      const record = records[index];
      if (!record) return terminal();
      const context: MiddlewareContext<TInput> = Object.freeze({
        ...createCapabilityContext(this.snapshot, record.owner),
        input,
      });
      await record.slot.definition.handle(context, () => dispatch(index + 1));
    };
    await dispatch(0);
  }
}

export function isMiddlewareIndex(value: unknown): value is MiddlewareIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.middleware-index/1';
}

function compareMiddleware(
  left: MiddlewareRecord,
  right: MiddlewareRecord,
  topology: ReadonlyMap<PluginId, number>,
): number {
  return phaseOrder(left.phase) - phaseOrder(right.phase)
    || left.order - right.order
    || (topology.get(left.owner) ?? Number.MAX_SAFE_INTEGER)
      - (topology.get(right.owner) ?? Number.MAX_SAFE_INTEGER)
    || left.slot.id.localeCompare(right.slot.id);
}

function phaseOrder(phase: MiddlewarePhase): number {
  return phase === 'before-dispatch' ? 0 : 1;
}

function topologyOrder(snapshot: RuntimeSnapshot): ReadonlyMap<PluginId, number> {
  const result = new Map<PluginId, number>();
  const visit = (owner: PluginId): void => {
    if (result.has(owner)) return;
    result.set(owner, result.size);
    for (const child of snapshot.tree.get(owner)?.children ?? []) visit(child);
  };
  visit(snapshot.root);
  return result;
}
