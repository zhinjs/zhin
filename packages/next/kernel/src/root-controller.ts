import type { PluginId } from './identity.js';
import {
  SnapshotStore,
  type PreparedGeneration,
  type RuntimeSnapshot,
  type SnapshotState,
} from './snapshot.js';

export type RootState = 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
export type PrepareGeneration = (
  current: RuntimeSnapshot,
) => PreparedGeneration | Promise<PreparedGeneration>;

export class RootController {
  readonly snapshots: SnapshotStore;
  #state: RootState = 'idle';
  #tail: Promise<unknown> = Promise.resolve();

  constructor(initial: SnapshotState) {
    this.snapshots = new SnapshotStore(initial);
  }

  get state(): RootState {
    return this.#state;
  }

  get generation(): number {
    return this.snapshots.current.generation;
  }

  start(prepare: PrepareGeneration): Promise<RuntimeSnapshot> {
    return this.#enqueue(async () => {
      if (this.#state !== 'idle') {
        throw new Error(`Cannot start RootController from ${this.#state}`);
      }
      try {
        const prepared = await prepare(this.snapshots.current);
        const snapshot = await this.snapshots.commit(0, prepared);
        this.#state = 'running';
        return snapshot;
      } catch (error) {
        this.#state = 'failed';
        throw error;
      }
    });
  }

  transact(prepare: PrepareGeneration): Promise<RuntimeSnapshot> {
    return this.#enqueue(async () => {
      if (this.#state !== 'running') {
        throw new Error(`Cannot transact RootController from ${this.#state}`);
      }
      const expected = this.snapshots.current.generation;
      const prepared = await prepare(this.snapshots.current);
      return this.snapshots.commit(expected, prepared);
    });
  }

  reload(
    _target: PluginId | string,
    prepare: PrepareGeneration,
  ): Promise<RuntimeSnapshot> {
    return this.transact(prepare);
  }

  stop(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state === 'stopped') return;
      if (this.#state !== 'running' && this.#state !== 'failed') {
        throw new Error(`Cannot stop RootController from ${this.#state}`);
      }
      this.#state = 'stopping';
      await this.snapshots.close();
      this.#state = 'stopped';
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
