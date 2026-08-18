import type { PluginId } from './identity.js';
import { GenerationCompensationError } from './handoff.js';
import {
  SnapshotStore,
  type PreparedGeneration,
  type RuntimeSnapshot,
  type SnapshotLease,
  type SnapshotReader,
  type SnapshotState,
} from './snapshot.js';

export type RootState = 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
export type PrepareGeneration = (
  current: RuntimeSnapshot,
  signal: AbortSignal,
) => PreparedGeneration | Promise<PreparedGeneration>;
export type PrepareTransaction = (
  current: RuntimeSnapshot,
  signal: AbortSignal,
) => PreparedGeneration | undefined | Promise<PreparedGeneration | undefined>;
export type ControlErrorHandler = (error: unknown) => void;
export interface GenerationCommitEvent {
  readonly previous: RuntimeSnapshot;
  readonly current: RuntimeSnapshot;
}
export type GenerationCommitListener = (event: GenerationCommitEvent) => void;

export class RootIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RootIntegrityError';
  }
}

export class RootController {
  readonly snapshots: SnapshotReader;
  readonly #snapshotStore: SnapshotStore;
  #state: RootState = 'idle';
  #tail: Promise<unknown> = Promise.resolve();
  #stopResult?: Promise<void>;
  #stopRequested = false;
  #activeTransaction?: AbortController;
  readonly #generationCommitListeners = new Set<GenerationCommitListener>();

  constructor(
    initial: SnapshotState,
    private readonly onControlError: ControlErrorHandler = () => undefined,
  ) {
    this.#snapshotStore = new SnapshotStore(initial, (error) => this.#failIntegrity(error));
    const store = this.#snapshotStore;
    this.snapshots = Object.freeze({
      acquire: () => {
        if (this.#state !== 'running' || this.#stopRequested) {
          throw new RootIntegrityError(`Root is not accepting generation operations (${this.#state})`);
        }
        return store.acquire();
      },
      owns: (lease: SnapshotLease) => store.owns(lease),
    });
  }

  get state(): RootState {
    return this.#state;
  }

  get generation(): number {
    return this.#snapshotStore.current.generation;
  }

  get snapshot(): RuntimeSnapshot {
    return this.#snapshotStore.current;
  }

  /** Observe successful generation commits, including the initial start. */
  onGenerationCommit(listener: GenerationCommitListener): () => void {
    this.#generationCommitListeners.add(listener);
    return () => {
      this.#generationCommitListeners.delete(listener);
    };
  }

  start(prepare: PrepareGeneration): Promise<RuntimeSnapshot> {
    return this.#enqueue(async () => {
      if (this.#state !== 'idle') {
        throw new Error(`Cannot start RootController from ${this.#state}`);
      }
      let prepared: PreparedGeneration | undefined;
      let activated = false;
      const transaction = new AbortController();
      this.#activeTransaction = transaction;
      try {
        prepared = await prepare(this.#snapshotStore.current, transaction.signal);
        if (prepared.handoff) {
          activated = true;
          await prepared.handoff.activateNext(transaction.signal);
        }
        this.#assertPublishable('idle');
        this.#state = 'running';
        const snapshot = this.#commitGeneration(0, prepared);
        prepared = undefined;
        return snapshot;
      } catch (error) {
        this.#state = 'failed';
        return this.#rollback(prepared, { activated }, error);
      } finally {
        if (this.#activeTransaction === transaction) this.#activeTransaction = undefined;
      }
    });
  }

  transact(prepare: PrepareTransaction): Promise<RuntimeSnapshot> {
    return this.#enqueue(async () => {
      if (this.#state !== 'running') {
        throw new Error(`Cannot transact RootController from ${this.#state}`);
      }
      const previous = this.snapshots.acquire();
      let prepared: PreparedGeneration | undefined;
      let activated = false;
      const transaction = new AbortController();
      this.#activeTransaction = transaction;
      try {
        prepared = await prepare(previous.value, transaction.signal);
        if (!prepared) return previous.value;
        if (prepared.handoff) {
          activated = true;
          await prepared.handoff.activateNext(transaction.signal);
        }
        this.#assertPublishable('running');
        const snapshot = this.#commitGeneration(previous.value.generation, prepared);
        prepared = undefined;
        return snapshot;
      } catch (error) {
        return this.#rollback(prepared, { activated }, error);
      } finally {
        if (this.#activeTransaction === transaction) this.#activeTransaction = undefined;
        previous.release();
      }
    });
  }

  reload(
    _target: PluginId | string,
    prepare: PrepareTransaction,
  ): Promise<RuntimeSnapshot> {
    return this.transact(prepare);
  }

  stop(): Promise<void> {
    if (this.#stopResult) return this.#stopResult;
    this.#stopRequested = true;
    this.#activeTransaction?.abort(new Error('Root lifecycle is stopping'));
    const result = this.#enqueue(async () => {
      if (this.#state === 'stopped') return;
      if (this.#state !== 'running' && this.#state !== 'failed') {
        throw new Error(`Cannot stop RootController from ${this.#state}`);
      }
      this.#state = 'stopping';
      try {
        await this.#snapshotStore.close();
      } finally {
        this.#state = 'stopped';
      }
    });
    this.#stopResult = result;
    return result;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  #commitGeneration(
    expectedGeneration: number,
    prepared: PreparedGeneration,
  ): RuntimeSnapshot {
    const previous = this.#snapshotStore.current;
    const snapshot = this.#snapshotStore.commit(expectedGeneration, prepared);
    const event = Object.freeze({ previous, current: snapshot });
    const listeners = [...this.#generationCommitListeners];
    queueMicrotask(() => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          this.#reportControlError(error);
        }
      }
    });
    return snapshot;
  }

  #reportControlError(error: unknown): void {
    try {
      this.onControlError(error);
    } catch {
      // Error reporting cannot roll back an already committed generation.
    }
  }

  async #rollback(
    prepared: PreparedGeneration | undefined,
    state: { readonly activated?: boolean },
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
    if (prepared) {
      try {
        await prepared.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 1 || transactionError instanceof GenerationCompensationError) {
      const aggregate = new AggregateError(
        errors,
        'Generation transaction and rollback both failed',
      );
      this.#failIntegrity(aggregate);
      throw new RootIntegrityError(
        'Root integrity failed while rolling back a generation transaction',
        { cause: aggregate },
      );
    }
    throw transactionError;
  }

  #failIntegrity(error: unknown): void {
    if (this.#state === 'stopped' || this.#state === 'stopping') return;
    this.#state = 'failed';
    this.#reportControlError(error);
  }

  #assertPublishable(expected: 'idle' | 'running'): void {
    if (this.#state !== expected || this.#stopRequested) {
      throw new RootIntegrityError(
        `Root cannot publish a generation after admission entered ${
          this.#stopRequested ? 'stopping' : this.#state
        }`,
      );
    }
  }
}
