import { normalizeModelCatalogConfig } from './catalog.js';
import type { ModelConnection, ResolvedInvocation } from './types.js';

export interface ModelSecretResolver {
  resolve(connection: ModelConnection): Promise<string | undefined>;
}
export interface ModelExecutionResource<T> {
  readonly resource: T;
  dispose(): void | Promise<void>;
}
export interface ModelResourceFactory<T> {
  /** The resolved secret exists only at this execution boundary. Never log it. */
  create(connection: ModelConnection, secret: string | undefined): ModelExecutionResource<T> | Promise<ModelExecutionResource<T>>;
}
export interface ModelLease<T> {
  readonly invocation: ResolvedInvocation;
  readonly resource: T;
  release(): Promise<void>;
}
export type ModelLeaseErrorCode = 'disposed' | 'cancelled' | 'revision-conflict' | 'secret-unavailable' | 'resource-create-failed' | 'resource-dispose-failed';
export class ModelLeaseError extends Error {
  constructor(readonly code: ModelLeaseErrorCode) {
    super(`Model execution: ${code}`);
    this.name = 'ModelLeaseError';
  }
}
interface Entry<T> {
  readonly connection: ModelConnection;
  readonly pending: Promise<ModelExecutionResource<T>>;
  refs: number;
  retired: boolean;
  disposal?: Promise<void>;
}
function snapshot(invocation: ResolvedInvocation): ResolvedInvocation {
  // Validate the execution boundary too; a structural caller cannot smuggle apiKey.
  const config = normalizeModelCatalogConfig({
    connections: { [invocation.connection.id]: invocation.connection },
    models: { [invocation.model.id]: invocation.model },
    presets: { [invocation.preset.id]: invocation.preset },
  });
  return Object.freeze({ connection: config.connections[invocation.connection.id], model: config.models[invocation.model.id], preset: config.presets[invocation.preset.id] });
}
function identity(connection: ModelConnection): string { return JSON.stringify([connection.ownerId, connection.id]); }
function version(connection: ModelConnection): string { return JSON.stringify([connection.ownerId, connection.id, connection.revision]); }
function fingerprint(connection: ModelConnection): string {
  return JSON.stringify([connection.ownerId, connection.id, connection.revision, connection.sdk, connection.baseUrl, connection.secretRef]);
}
async function cancellable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) throw new ModelLeaseError('cancelled');
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(new ModelLeaseError('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

/** Owns connection resources, never Session or IM state. */
export class ModelLeaseRuntime<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #all = new Set<Entry<T>>();
  readonly #cleanupFailures: ModelLeaseError[] = [];
  readonly #definitions = new Map<string, string>();
  readonly #current = new Map<string, Entry<T>>();
  readonly #latest = new Map<string, number>();
  #closed = false;
  #closing?: Promise<void>;
  constructor(private readonly options: { readonly secrets: ModelSecretResolver; readonly factory: ModelResourceFactory<T> }) {}

  async acquire(input: ResolvedInvocation, options: { readonly signal?: AbortSignal } = {}): Promise<ModelLease<T>> {
    if (this.#closed) throw new ModelLeaseError('disposed');
    if (options.signal?.aborted) throw new ModelLeaseError('cancelled');
    const invocation = snapshot(input);
    const connection = invocation.connection;
    const key = version(connection);
    const shape = fingerprint(connection);
    const known = this.#definitions.get(key);
    if (known !== undefined && known !== shape) throw new ModelLeaseError('revision-conflict');
    this.#definitions.set(key, shape);
    let entry = this.#entries.get(key);
    if (entry?.disposal) entry = undefined;
    if (!entry) {
      const ownerKey = identity(connection);
      const previous = this.#current.get(ownerKey);
      const latest = this.#latest.get(ownerKey) ?? connection.revision;
      const retired = connection.revision < latest;
      this.#latest.set(ownerKey, Math.max(latest, connection.revision));
      entry = { connection, refs: 0, retired,
        pending: this.#create(connection) };
      this.#entries.set(key, entry);
      this.#all.add(entry);
      if (!retired) {
        this.#current.set(identity(connection), entry);
        if (previous) {
          previous.retired = true;
          // Retiring an idle resource does not make a new acquire depend on its cleanup.
          void this.#clean(previous).catch(() => { this.#cleanupFailures.push(new ModelLeaseError('resource-dispose-failed')); });
        }
      }
      const created = entry;
      // Creation owns its failed state even when every waiter has cancelled.
      // Keep the original Promise for waiters; retiring it must not await itself.
      void created.pending.catch(() => {
        created.retired = true;
        void this.#clean(created).catch(() => { this.#cleanupFailures.push(new ModelLeaseError('resource-dispose-failed')); });
      });
    }
    const acquired = entry;
    acquired.refs++;
    try {
      const execution = await cancellable(acquired.pending, options.signal);
      if (options.signal?.aborted) throw new ModelLeaseError('cancelled');
      let release: Promise<void> | undefined;
      return Object.freeze({ invocation, resource: execution.resource,
        release: () => release ??= this.#release(acquired) });
    } catch (error) {
      // Cancellation belongs to this waiter; creation and other leases remain independent.
      if (!(error instanceof ModelLeaseError && error.code === 'cancelled')) acquired.retired = true;
      const cleanup = this.#release(acquired).catch(() => { this.#cleanupFailures.push(new ModelLeaseError('resource-dispose-failed')); });
      if (!(error instanceof ModelLeaseError && error.code === 'cancelled')) await cleanup;
      throw error;
    }
  }

  async #create(connection: ModelConnection): Promise<ModelExecutionResource<T>> {
    let secret: string | undefined;
    if (connection.secretRef !== undefined) {
      try { secret = await this.options.secrets.resolve(connection); }
      catch { throw new ModelLeaseError('secret-unavailable'); }
      if (typeof secret !== 'string' || !secret.trim()) throw new ModelLeaseError('secret-unavailable');
    }
    try { return await this.options.factory.create(connection, secret); }
    catch { throw new ModelLeaseError('resource-create-failed'); }
  }
  async #release(entry: Entry<T>): Promise<void> {
    entry.refs--;
    await this.#clean(entry);
  }
  #clean(entry: Entry<T>): Promise<void> {
    if (!entry.retired || entry.refs !== 0) return Promise.resolve();
    if (entry.disposal) return entry.disposal;
    entry.disposal = (async () => {
      try {
        const resource = await entry.pending;
        try { await resource.dispose(); }
        catch { throw new ModelLeaseError('resource-dispose-failed'); }
      } catch (error) {
        if (error instanceof ModelLeaseError && error.code === 'resource-dispose-failed') throw error;
        // Failed creation owns no resource to dispose.
      } finally {
        this.#all.delete(entry);
        const key = version(entry.connection);
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        if (this.#current.get(identity(entry.connection)) === entry) this.#current.delete(identity(entry.connection));
      }
    })();
    return entry.disposal;
  }

  /** Stop admission; outstanding leases remain usable until their explicit release. */
  dispose(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const entries = [...this.#all];
    for (const entry of entries) entry.retired = true;
    this.#closing = Promise.all(entries.map(entry => this.#clean(entry))).then(() => {
      if (this.#cleanupFailures.length) throw this.#cleanupFailures[0];
    });
    return this.#closing;
  }
}
