import type { CapabilitySlot } from './capability.js';
import type { Dispose } from './dispose.js';
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
  readonly packageRoot: string;
  readonly parent?: PluginId;
  readonly children: readonly PluginId[];
  readonly metadata?: PluginMetadata;
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

export interface PreparedGeneration {
  readonly snapshot: SnapshotState;
  readonly dispose: Dispose;
}

interface SnapshotRecord {
  readonly snapshot: RuntimeSnapshot;
  readonly dispose: Dispose;
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

export class SnapshotLease {
  #released = false;

  constructor(
    readonly value: RuntimeSnapshot,
    private readonly releaseRecord: () => void,
  ) {}

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.releaseRecord();
  }
}

export class SnapshotStore {
  #current: SnapshotRecord;
  readonly #retired = new Set<SnapshotRecord>();
  #closed = false;

  constructor(initial: SnapshotState) {
    this.#current = {
      snapshot: createSnapshotView(0, initial),
      dispose: () => undefined,
      leases: 0,
      retired: false,
    };
  }

  get current(): RuntimeSnapshot {
    return this.#current.snapshot;
  }

  acquire(): SnapshotLease {
    if (this.#closed) throw new Error('SnapshotStore is closed');
    const record = this.#current;
    record.leases += 1;
    return new SnapshotLease(record.snapshot, () => {
      record.leases -= 1;
      this.#disposeIfReady(record);
    });
  }

  async commit(
    expectedGeneration: number,
    prepared: PreparedGeneration,
  ): Promise<RuntimeSnapshot> {
    if (this.#closed) {
      await prepared.dispose();
      throw new Error('SnapshotStore is closed');
    }
    if (this.#current.snapshot.generation !== expectedGeneration) {
      await prepared.dispose();
      throw new GenerationConflictError(
        expectedGeneration,
        this.#current.snapshot.generation,
      );
    }

    const previous = this.#current;
    // Commit only swaps the active pointer. The previous record may still be
    // serving in-flight work, so disposal is deferred to its final lease.
    this.#current = {
      snapshot: createSnapshotView(expectedGeneration + 1, prepared.snapshot),
      dispose: prepared.dispose,
      leases: 0,
      retired: false,
    };
    previous.retired = true;
    this.#retired.add(previous);
    this.#disposeIfReady(previous);
    return this.#current.snapshot;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#current.retired = true;
    this.#retired.add(this.#current);
    this.#disposeIfReady(this.#current);
    // A Root is not stopped while any historical generation still owns live
    // resources. This also surfaces deferred disposer failures to the caller.
    await Promise.all([...this.#retired].map((record) => this.#waitForDisposal(record)));
    this.#retired.clear();
  }

  #disposeIfReady(record: SnapshotRecord): void {
    if (!record.retired || record.leases !== 0) return;
    if (!record.disposing) {
      record.disposing = Promise.resolve().then(record.dispose);
      void record.disposing.then(
        () => record.drain?.resolve(),
        (error) => record.drain?.reject(error),
      );
    }
  }

  #waitForDisposal(record: SnapshotRecord): Promise<void> {
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

export function createSnapshotView(
  generation: number,
  state: SnapshotState,
): RuntimeSnapshot {
  // Object.freeze(Map) does not disable Map#set. ReadonlyMapView removes the
  // mutator interface at runtime, including from provider projection hooks.
  return Object.freeze({
    ...state,
    generation,
    tree: readonlyMap(state.tree),
    config: readonlyMap(state.config),
    resources: readonlyMap(
      [...state.resources].map(([owner, resources]) => [owner, readonlyMap(resources)]),
    ),
    capabilities: readonlyMap(state.capabilities),
    projections: readonlyMap(state.projections),
  });
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
