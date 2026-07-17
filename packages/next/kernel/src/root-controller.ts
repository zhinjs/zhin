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
export type ControlErrorHandler = (error: unknown) => void;

export class RootController {
  readonly snapshots: SnapshotStore;
  #state: RootState = 'idle';
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    initial: SnapshotState,
    private readonly onControlError: ControlErrorHandler = () => undefined,
  ) {
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
      let prepared: PreparedGeneration | undefined;
      let activated = false;
      try {
        prepared = await prepare(this.snapshots.current);
        if (prepared.handoff) {
          activated = true;
          await prepared.handoff.activateNext();
        }
        const handoff = prepared.handoff;
        const snapshot = this.snapshots.commit(0, prepared);
        prepared = undefined;
        this.#state = 'running';
        this.#openNext(handoff);
        return snapshot;
      } catch (error) {
        this.#state = 'failed';
        return this.#rollback(prepared, { activated }, error);
      }
    });
  }

  transact(prepare: PrepareGeneration): Promise<RuntimeSnapshot> {
    return this.#enqueue(async () => {
      if (this.#state !== 'running') {
        throw new Error(`Cannot transact RootController from ${this.#state}`);
      }
      const previous = this.snapshots.acquire();
      let prepared: PreparedGeneration | undefined;
      let quiesced = false;
      let activated = false;
      try {
        prepared = await prepare(previous.value);
        if (prepared.handoff) {
          quiesced = true;
          await prepared.handoff.quiescePrevious(previous.value);
          activated = true;
          await prepared.handoff.activateNext();
        }
        const handoff = prepared.handoff;
        const snapshot = this.snapshots.commit(previous.value.generation, prepared);
        prepared = undefined;
        this.#openNext(handoff);
        return snapshot;
      } catch (error) {
        return this.#rollback(prepared, { quiesced, activated }, error);
      } finally {
        previous.release();
      }
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

  #openNext(handoff: PreparedGeneration['handoff']): void {
    try {
      handoff?.openNext();
    } catch (error) {
      try {
        this.onControlError(error);
      } catch {
        // Error reporting cannot roll back an already committed generation.
      }
    }
  }

  async #rollback(
    prepared: PreparedGeneration | undefined,
    state: { readonly quiesced?: boolean; readonly activated?: boolean },
    transactionError: unknown,
  ): Promise<never> {
    const errors = [transactionError];
    if (prepared && state.activated) {
      try {
        await prepared.handoff?.deactivateNext();
      } catch (error) {
        errors.push(error);
      }
    }
    if (prepared && state.quiesced) {
      try {
        await prepared.handoff?.resumePrevious();
      } catch (error) {
        errors.push(error);
      }
    }
    if (prepared) {
      try {
        await prepared.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Generation transaction and rollback both failed');
    }
    throw transactionError;
  }
}
