import type { Token } from './token.js';
import type { CapabilitySlot } from './capability.js';
import {
  collectGenerationAdmissions,
  replaceGenerationAdmissions,
  type GenerationAdmissionGate,
} from './admission.js';
import type { Dispose } from './dispose.js';
import type { GenerationHandoff } from './handoff.js';
import type {
  CapabilityId,
  FeatureId,
  PluginId,
  TokenId,
} from './identity.js';
import type { PluginMetadata } from './plugin.js';

export interface PluginNodeSnapshot {
  readonly id: PluginId;
  readonly instanceKey: string;
  readonly packageName: string;
  /** Package version read when this owner was assembled, never from later disk contents. */
  readonly packageVersion?: string;
  readonly packageRoot: string;
  readonly parent?: PluginId;
  readonly children: readonly PluginId[];
  readonly metadata?: PluginMetadata;
  /** Immutable schema declaration belonging to this committed generation. */
  readonly configSchema?: Readonly<Record<string, unknown>>;
}

export interface RuntimeSnapshot {
  readonly generation: number;
  readonly root: PluginId;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;
  readonly config: ReadonlyMap<PluginId, unknown>;
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilitySlot>;
  readonly projections: ReadonlyMap<FeatureId, unknown>;
}

export type SnapshotState = Omit<RuntimeSnapshot, 'generation'>;

interface PreparedGenerationBase {
  readonly snapshot: SnapshotState;
  readonly dispose: Dispose;
  readonly handoff?: GenerationHandoff;
}

export type PreparedGeneration<TState = undefined> = PreparedGenerationBase
  & ([TState] extends [undefined]
    ? { readonly state?: undefined }
    : { /** State published atomically with the snapshot pointer. */ readonly state: TState });

export interface CommittedGeneration<TState = undefined> {
  readonly snapshot: RuntimeSnapshot;
  readonly state: TState;
}

interface SnapshotRecord<TState> extends CommittedGeneration<TState> {
  readonly retirement: AbortController;
  readonly committed: CommittedGeneration<TState>;
  readonly dispose: Dispose;
  readonly admissions: ReadonlySet<GenerationAdmissionGate>;
  leases: number;
  retired: boolean;
  disposing?: Promise<void>;
  drain?: {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  };
}

export class GenerationConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`Generation conflict: expected ${expected}, actual ${actual}`);
    this.name = 'GenerationConflictError';
  }
}

const snapshotLeaseAuthority = Symbol('SnapshotLeaseAuthority');

/** One exact retained record and its two independent lifecycle facts. */
interface SnapshotLeaseConstruction {
  readonly value: RuntimeSnapshot;
  readonly releaseRecord: () => void;
  readonly retirementSignal: AbortSignal;
  readonly stopSignal: AbortSignal;
}

export class SnapshotLease {
  #released = false;
  readonly value: RuntimeSnapshot;
  private readonly releaseRecord: () => void;
  /** Aborted on publication of a replacement or Root close, before lease disposal. */
  readonly retirementSignal: AbortSignal;
  /** Root closure only; shared by leases from every generation and never aborted by HMR. */
  readonly stopSignal: AbortSignal;

  constructor(input: SnapshotLeaseConstruction, authority: typeof snapshotLeaseAuthority) {
    if (authority !== snapshotLeaseAuthority) throw new TypeError('SnapshotLease is owned by SnapshotStore');
    this.value = input.value;
    this.releaseRecord = input.releaseRecord;
    this.retirementSignal = input.retirementSignal;
    this.stopSignal = input.stopSignal;
  }

  get active(): boolean {
    return !this.#released;
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.releaseRecord();
  }
}

export type RootResourceResolver<TState> = (state: TState, root: PluginId, token: Token<unknown>) => unknown;

/** Read-only operation seam exposed only to trusted Host integrations, never Plugin setup. */
export interface SnapshotReader {
  acquire(): SnapshotLease;
  /** Independently retain this exact owned generation, including after replacement. */
  retain(lease: SnapshotLease): SnapshotLease;
  owns(lease: SnapshotLease): boolean;
  /** Exact leased generation, including private Root resources excluded from public snapshots. */
  rootResource?<T>(lease: SnapshotLease, token: Token<T>): T | undefined;
}

export class SnapshotStore<TState = undefined> implements SnapshotReader {
  #current: SnapshotRecord<TState>;
  readonly #retired = new Set<SnapshotRecord<TState>>();
  readonly #leases = new WeakMap<SnapshotLease, SnapshotRecord<TState> | null>();
  readonly #rootResource?: RootResourceResolver<TState>;
  #closed = false;
  readonly #stop = new AbortController();

  constructor(
    initial: SnapshotState,
    private readonly onDisposalError: (error: unknown) => void = () => undefined,
    ...state: [TState] extends [undefined]
      ? [initialState?: undefined, rootResource?: RootResourceResolver<TState>]
      : [initialState: TState, rootResource?: RootResourceResolver<TState>]
  ) {
    const initialState = state[0] as TState;
    this.#rootResource = state[1];
    const snapshot = createSnapshotView(0, initial);
    const committed = Object.freeze({ snapshot, state: initialState });
    const admissions = collectSnapshotAdmissions(snapshot);
    const record: SnapshotRecord<TState> = {
      retirement: new AbortController(),
      snapshot,
      state: initialState,
      committed,
      dispose: () => undefined,
      admissions,
      leases: 0,
      retired: false,
    };
    this.#current = record;
    replaceGenerationAdmissions({ previous: new Set(), next: admissions, owner: this,
      publishNext: () => undefined, acquireNext: () => this.#retain(record), stopSignal: this.#stop.signal });
  }

  get current(): RuntimeSnapshot {
    return this.#current.snapshot;
  }

  /** Complete active record; snapshot and state always belong to one generation. */
  get committed(): CommittedGeneration<TState> {
    return this.#current.committed;
  }

  acquire(): SnapshotLease {
    if (this.#closed) throw new Error('SnapshotStore is closed');
    return this.#lease(this.#current);
  }

  retain(lease: SnapshotLease): SnapshotLease {
    if (this.#closed) throw new Error('SnapshotStore is closed');
    const record = this.#leases.get(lease);
    if (!record || !lease.active) throw new Error('Snapshot retention requires an active owned lease');
    return this.#lease(record);
  }

  #lease(record: SnapshotRecord<TState>): SnapshotLease {
    const releaseRecord = this.#retain(record);
    const lease = new SnapshotLease({
      value: record.snapshot,
      releaseRecord: () => {
        this.#leases.set(lease, null);
        releaseRecord();
      },
      retirementSignal: record.retirement.signal,
      stopSignal: this.#stop.signal,
    }, snapshotLeaseAuthority);
    this.#leases.set(lease, record);
    return lease;
  }

  owns(lease: SnapshotLease): boolean {
    return this.#leases.has(lease);
  }

  rootResource<T>(lease: SnapshotLease, token: Token<T>): T | undefined {
    const record = this.#leases.get(lease);
    if (!record || !lease.active) throw new Error('Root resource access requires an active owned SnapshotLease');
    // Manually authored snapshots retain their explicit resource contract. Real
    // Runtime Roots inject the same-generation Scope resolver, including privacy checks.
    return (this.#rootResource
      ? this.#rootResource(record.state, record.snapshot.root, token)
      : record.snapshot.resources.get(record.snapshot.root)?.get(token.id)) as T | undefined;
  }

  commit(
    expectedGeneration: number,
    prepared: PreparedGeneration<TState>,
  ): CommittedGeneration<TState> {
    // The caller owns a candidate until this method succeeds. This lets the
    // transaction authority undo handoff state before disposing a rejection.
    if (this.#closed) {
      throw new Error('SnapshotStore is closed');
    }
    if (this.#current.snapshot.generation !== expectedGeneration) {
      throw new GenerationConflictError(
        expectedGeneration,
        this.#current.snapshot.generation,
      );
    }

    const previous = this.#current;
    const snapshot = createSnapshotView(expectedGeneration + 1, prepared.snapshot);
    const state = prepared.state as TState;
    const committed = Object.freeze({ snapshot, state });
    const admissions = collectSnapshotAdmissions(snapshot);
    const next: SnapshotRecord<TState> = {
      retirement: new AbortController(),
      snapshot,
      state,
      committed,
      dispose: prepared.dispose,
      admissions,
      leases: 0,
      retired: false,
    };
    replaceGenerationAdmissions({ previous: previous.admissions, next: admissions, owner: this,
      publishNext: () => { this.#current = next; }, acquireNext: () => this.#retain(next), stopSignal: this.#stop.signal });
    // Commit only swaps the active pointer. The previous record may still be
    // serving in-flight work, so disposal is deferred to its final lease.
    previous.retired = true;
    previous.retirement.abort();
    this.#retired.add(previous);
    this.#disposeIfReady(previous);
    return this.#current.committed;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    replaceGenerationAdmissions({ previous: this.#current.admissions, next: new Set(), owner: this,
      publishNext: () => undefined, stopSignal: this.#stop.signal });
    // Stop observers may synchronously release transports; no gate may admit fresh work then.
    this.#stop.abort();
    this.#current.retired = true;
    this.#current.retirement.abort();
    this.#retired.add(this.#current);
    this.#disposeIfReady(this.#current);
    // A Root is not stopped while any historical generation still owns live
    // resources. This also surfaces deferred disposer failures to the caller.
    await Promise.all([...this.#retired].map((record) => this.#waitForDisposal(record)));
    this.#retired.clear();
  }

  #disposeIfReady(record: SnapshotRecord<TState>): void {
    if (!record.retired || record.leases !== 0) return;
    if (!record.disposing) {
      record.disposing = Promise.resolve().then(record.dispose);
      void record.disposing.then(
        () => record.drain?.resolve(),
        (error) => {
          record.drain?.reject(error);
          this.onDisposalError(error);
        },
      );
    }
  }

  #retain(record: SnapshotRecord<TState>): () => void {
    record.leases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      record.leases -= 1;
      if (record.leases < 0) throw new Error('Snapshot lease underflow');
      this.#disposeIfReady(record);
    };
  }

  #waitForDisposal(record: SnapshotRecord<TState>): Promise<void> {
    if (record.disposing) return record.disposing;
    if (!record.drain) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      record.drain = { promise, resolve, reject };
    }
    return record.drain.promise;
  }
}

function collectSnapshotAdmissions(snapshot: RuntimeSnapshot): ReadonlySet<GenerationAdmissionGate> {
  return collectGenerationAdmissions([
    ...snapshot.projections.values(),
    ...[...snapshot.resources.values()].flatMap((resources) => [...resources.values()]),
  ]);
}

export function createSnapshotView(
  generation: number,
  state: SnapshotState,
): RuntimeSnapshot {
  // Object.freeze(Map) does not disable Map#set. ReadonlyMapView removes the
  // mutator interface at runtime, including from provider projection hooks.
  return Object.freeze({
    ...state,
    generation,
    tree: readonlyMap([...state.tree].map(([owner, node]) => [owner, node.configSchema
      ? Object.freeze({ ...node, configSchema: freezeSchema(structuredClone(node.configSchema)) })
      : node])),
    config: readonlyMap(state.config),
    resources: readonlyMap(
      [...state.resources].map(([owner, resources]) => [owner, readonlyMap(resources)]),
    ),
    capabilities: readonlyMap(state.capabilities),
    projections: readonlyMap(state.projections),
  });
}

function freezeSchema<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
  return value;
}

class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    this.#values.forEach((value, key) => callback(value, key, this));
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

function readonlyMap<K, V>(values: ReadonlyMap<K, V> | Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new ReadonlyMapView(values);
}

/** Compatibility for Host embedders that implement the original minimal SnapshotReader. */
export function readLeasedRootResource<T>(reader: SnapshotReader, lease: SnapshotLease, token: Token<T>): T | undefined {
  if (!reader.owns(lease) || !lease.active) throw new Error('Root resource access requires an active owned SnapshotLease');
  return reader.rootResource ? reader.rootResource(lease, token)
    : lease.value.resources.get(lease.value.root)?.get(token.id) as T | undefined;
}
