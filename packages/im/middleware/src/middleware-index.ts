import type { CapabilitySlot, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  createCapabilityContext,
  bindOperationInput,
  operationClientAdapter,
  readOperationClient,
  readOperationSession,
} from '@zhin.js/feature-kit';
import type {
  InboundDispatchSummary,
  MiddlewareContext,
  MiddlewareDefinition,
  MiddlewarePhase,
  MiddlewareTarget,
  OutboundMiddlewareNext,
} from './definition.js';
import { continuationBrand, type MiddlewareContinuation } from './continuation.js';
import { permissionHostToken, toPermissionSubject, type PermissionHost } from '@zhin.js/permission';

/** @internal Terminal control passed to inbound terminal callbacks to publish dispatch summary before after-dispatch unwinds. */
export interface InboundTerminalControl {
  reportDispatch(summary: InboundDispatchSummary): Promise<void>;
}

/** @internal Transmission-neutral result policy supplied by the composition layer. */
export interface MiddlewareResultPolicy<TResult> {
  stop(owner: PluginId): TResult;
  replace(owner: PluginId, value: unknown, downstream: TResult | undefined): TResult;
  summarize?(result: TResult): InboundDispatchSummary | undefined;
}

/** @internal Runtime continuation result. */
export interface MiddlewareRunResult {
  readonly owner?: PluginId;
  readonly value?: unknown;
}

/** @internal Runtime inventory projection. */
export interface MiddlewareDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly phase: MiddlewarePhase;
  readonly target: MiddlewareTarget;
  readonly order: number;
  readonly adapter?: string;
  readonly incremental?: true;
  /** Inbound permit (ADR 0056 §5); unmet = skipped for that message. */
  readonly permit?: readonly string[];
}

interface MiddlewareRecord extends MiddlewareDescriptor {
  readonly slot: Readonly<CapabilitySlot<MiddlewareDefinition>>;
}

/** @internal Runtime middleware executor. */
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
      ...(slot.definition.adapter ? { adapter: slot.definition.adapter } : {}),
      ...(slot.definition.target === 'outbound' && slot.definition.incremental === true ? { incremental: true as const } : {}),
      ...(slot.definition.target === 'inbound' && slot.definition.permit?.length ? { permit: slot.definition.permit } : {}),
      slot,
    })).sort((left, right) => compareMiddleware(left, right, topology)));
  }

  list(): readonly MiddlewareDescriptor[] {
    return this.#records.map(({ slot: _slot, ...descriptor }) => descriptor);
  }

  run<TInput>(input: TInput, terminal?: OutboundMiddlewareNext, target?: 'inbound', operationSnapshot?: RuntimeSnapshot): Promise<MiddlewareRunResult>;
  run<TInput>(input: TInput, terminal: OutboundMiddlewareNext | undefined, target: 'outbound', operationSnapshot?: RuntimeSnapshot): Promise<void>;
  run<TInput>(input: TInput, terminal: OutboundMiddlewareNext | undefined, target: MiddlewareTarget, operationSnapshot?: RuntimeSnapshot): Promise<MiddlewareRunResult | void>;
  async run<TInput>(
    input: TInput,
    terminal: OutboundMiddlewareNext = async () => undefined,
    target: MiddlewareTarget = 'inbound',
    operationSnapshot: RuntimeSnapshot = this.snapshot,
  ): Promise<MiddlewareRunResult | void> {
    if (target === 'inbound') {
      return this.runInbound(input, async () => { await terminal(); return {}; }, {
        stop: (owner) => ({ owner }),
        replace: (owner, value) => ({ owner, value }),
      }, operationSnapshot);
    }
    const clientAdapter = operationClientAdapter(input);
    const records = this.#records.filter((record) =>
      record.target === target && (!record.adapter || record.adapter === clientAdapter));
    let cursor = -1;
    const dispatch = async (index: number): Promise<void> => {
      if (index <= cursor) throw new Error('Middleware next() called more than once');
      cursor = index;
      const record = records[index];
      if (!record) return terminal();
      const authorInput = bindOperationInput(input, record.owner, operationSnapshot);
      const context = {
        ...createCapabilityContext({ snapshot: operationSnapshot, ownerId: record.owner, admission: undefined, signal: readOperationSession(authorInput, record.adapter)?.signal }),
        input: authorInput,
      } as MiddlewareContext<TInput>;
      Object.defineProperty(context, 'session', {
        enumerable: true, get: () => readOperationSession(authorInput, record.adapter),
      });
      Object.defineProperty(context, '$client', {
        enumerable: true,
        get: () => readOperationClient(authorInput, record.adapter),
      });
      Object.freeze(context);
      const definition = record.slot.definition;
      if (definition.target !== 'outbound') throw new Error('Invalid outbound Middleware');
      const result = await definition.handle.call(context, context, () => dispatch(index + 1));
      if (result !== undefined) throw new TypeError('Outbound Middleware must use input.replace(), not return content');
    };
    await dispatch(0);
  }

  /** Unwinds one inbound operation before its caller performs any automatic reply. */
  async runInbound<TInput, TResult>(
    input: TInput,
    terminal: (control: InboundTerminalControl) => Promise<TResult>,
    results: MiddlewareResultPolicy<TResult>,
    operationSnapshot: RuntimeSnapshot = this.snapshot,
  ): Promise<TResult> {
    const clientAdapter = operationClientAdapter(input);
    const records = this.#records.filter((record) => record.target === 'inbound'
      && (!record.adapter || record.adapter === clientAdapter));
    let dispatchSummary: InboundDispatchSummary | undefined;
    let reported = false;
    const afterDispatchListeners: Array<(summary: InboundDispatchSummary) => void | Promise<void>> = [];
    const reportDispatch = async (summary: InboundDispatchSummary): Promise<void> => {
      dispatchSummary = Object.freeze({ ...summary });
      if (reported) return;
      reported = true;
      for (const listener of afterDispatchListeners.splice(0)) {
        await listener(dispatchSummary);
      }
    };
    const dispatch = async (index: number): Promise<TResult> => {
      const record = records[index];
      if (!record) {
        const terminalResult = await terminal({ reportDispatch });
        if (!reported) {
          const inferred = results.summarize?.(terminalResult)
            ?? { matched: false, path: 'none' as const, replied: false };
          await reportDispatch(inferred);
        }
        return terminalResult;
      }
      const definition = record.slot.definition;
      if (definition.target !== 'inbound') throw new Error('Invalid inbound Middleware');
      if (record.permit && !(await permitAllows(record.permit, input, operationSnapshot))) return dispatch(index + 1);
      const authorInput = bindOperationInput(input, record.owner, operationSnapshot);
      const context = {
        ...createCapabilityContext({ snapshot: operationSnapshot, ownerId: record.owner, admission: undefined, signal: readOperationSession(authorInput, record.adapter)?.signal }), input: authorInput,
        onAfterDispatch(listener: (summary: InboundDispatchSummary) => void | Promise<void>) {
          if (typeof listener !== 'function') {
            throw new TypeError('Middleware onAfterDispatch listener must be a function');
          }
          afterDispatchListeners.push(listener);
        },
      } as MiddlewareContext<TInput>;
      Object.defineProperty(context, 'session', {
        enumerable: true, get: () => readOperationSession(authorInput, record.adapter),
      });
      Object.defineProperty(context, '$client', {
        enumerable: true, get: () => readOperationClient(authorInput, record.adapter),
      });
      Object.defineProperty(context, 'dispatch', {
        enumerable: true, get: () => dispatchSummary,
      });
      Object.freeze(context);
      let active = true;
      let nextCalled = false;
      let nextTask: Promise<TResult> | undefined;
      let carrier: MiddlewareContinuation | undefined;
      const next = (): Promise<MiddlewareContinuation> => {
        if (!active) throw new Error('Middleware next() scope has ended');
        if (nextCalled) throw new Error('Middleware next() called more than once');
        nextCalled = true;
        nextTask = dispatch(index + 1);
        // Attach a rejection observer immediately even when an author forgets await.
        void nextTask.catch(() => undefined);
        const continuation = nextTask.then(() => {
          carrier = Object.freeze({ [continuationBrand]: undefined as never });
          return carrier;
        });
        void continuation.catch(() => undefined);
        return continuation;
      };
      let returned: unknown;
      try {
        returned = await definition.handle.call(context, context, next);
      } catch (error) {
        // Drain an admitted child before the owning generation lease can close.
        await nextTask?.catch(() => undefined);
        throw error;
      } finally {
        active = false;
      }
      const downstream = nextTask ? await nextTask : undefined;
      if (returned === undefined) return nextTask ?? results.stop(record.owner);
      if (returned && typeof returned === 'object' && continuationBrand in returned) {
        if (returned !== carrier) throw new Error('Middleware continuation belongs to another frame or operation');
        if (!nextTask) throw new Error('Middleware continuation has no downstream operation');
        return nextTask;
      }
      return results.replace(record.owner, returned, downstream);
    };
    return dispatch(0);
  }
}

/**
 * ADR 0056 §5: the shared evaluator; the Bot's own standing comes from the cache only, so a gate
 * never adds a platform request to a message. No Permission host = unmet (fail closed).
 */
async function permitAllows(permits: readonly string[], input: unknown, snapshot: RuntimeSnapshot): Promise<boolean> {
  let host: PermissionHost | undefined;
  try {
    const value = snapshot.resources.get(snapshot.root)?.get(permissionHostToken.id) as PermissionHost | undefined;
    host = value && typeof value.checkAll === 'function' ? value : undefined;
  } catch { host = undefined; }
  if (!host) return false;
  try { return await host.checkAll(permits, toPermissionSubject(input), { source: input, cachedOnly: true }); }
  catch { return false; }
}

/** @internal Runtime projection guard. */
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
