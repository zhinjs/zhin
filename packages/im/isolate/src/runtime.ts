import { pathToFileURL } from 'node:url';
import {
  createGenerationAdmissionGate,
  generationAdmissionSource,
  type GenerationAdmissionGate,
  type PluginId,
  type PluginMetadata,
} from '@zhin.js/plugin-runtime';
import type {
  IsolatedPluginPrepareRequest,
  IsolatedPluginRuntimePort,
  PreparedIsolatedPlugin,
} from '@zhin.js/runtime';
import {
  isolatedPluginToken,
  type IsolatedPluginEvent,
  type IsolatedPluginHandle,
  type IsolatedPluginStatus,
} from './contracts.js';
import {
  deserializeError,
  serializeError,
  type HostCallMessage,
  type HostMessage,
  type RequestMessage,
} from './protocol.js';
import { createTransport, type IsolateMode, type MessageTransport } from './transport.js';

export interface IsolatedHostCallContext {
  readonly owner: PluginId;
}

export type IsolatedHostMethod = (
  input: unknown,
  context: IsolatedHostCallContext,
) => unknown | Promise<unknown>;

export interface NodeIsolatedPluginRuntimeOptions {
  readonly mode?: IsolateMode;
  readonly requestTimeoutMs?: number;
  readonly hostMethods?: Readonly<Record<string, IsolatedHostMethod>>;
  readonly onCrash?: (owner: PluginId, error: Error) => void;
}

/** Node isolation adapter with one Worker/process per Plugin generation. */
export class NodeIsolatedPluginRuntime implements IsolatedPluginRuntimePort {
  readonly #mode: IsolateMode;
  readonly #requestTimeoutMs: number;
  readonly #hostMethods: Readonly<Record<string, IsolatedHostMethod>>;
  readonly #onCrash?: (owner: PluginId, error: Error) => void;
  constructor(options: NodeIsolatedPluginRuntimeOptions = {}) {
    this.#mode = options.mode ?? 'worker';
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#hostMethods = Object.freeze({ ...options.hostMethods });
    this.#onCrash = options.onCrash;
  }

  async prepare(
    request: IsolatedPluginPrepareRequest,
    signal: AbortSignal,
  ): Promise<PreparedIsolatedPlugin> {
    signal.throwIfAborted();
    assertCloneable(request.config, `Config for ${request.owner}`);
    const admission = createGenerationAdmissionGate();
    const instance = new IsolatedInstance(
      request.owner,
      createTransport(this.#mode),
      this.#requestTimeoutMs,
      this.#hostMethods,
      this.#onCrash,
      admission,
    );
    try {
      const descriptor = await instance.requestAbortable<{
        name: string;
        metadata?: PluginMetadata;
      }>('prepare', {
        ...request,
        entry: pathToFileURL(request.entry).href,
      }, signal);
      return {
        descriptor,
        resources: [{ token: isolatedPluginToken, value: instance }],
        handoff: {
          activateNext: (activationSignal) => instance.activate(activationSignal),
          deactivateNext: () => instance.deactivate(),
        },
        dispose: () => instance.close(),
      };
    } catch (error) {
      await instance.close();
      throw error;
    }
  }
}

class IsolatedInstance implements IsolatedPluginHandle {
  readonly [generationAdmissionSource]: readonly GenerationAdmissionGate[];
  #status: IsolatedPluginStatus = 'prepared';
  #nextRequest = 1;
  #closed = false;
  readonly #pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }>();
  readonly #listeners = new Set<(event: IsolatedPluginEvent) => void>();

  constructor(
    readonly owner: PluginId,
    private readonly transport: MessageTransport,
    private readonly timeoutMs: number,
    private readonly hostMethods: Readonly<Record<string, IsolatedHostMethod>>,
    private readonly onCrash?: (owner: PluginId, error: Error) => void,
    private readonly admission: GenerationAdmissionGate = createGenerationAdmissionGate(),
  ) {
    this[generationAdmissionSource] = Object.freeze([admission]);
    transport.onMessage((message) => this.#onMessage(message));
    transport.onExit((error) => this.#fail(error));
  }

  get status(): IsolatedPluginStatus { return this.#status; }

  async activate(signal: AbortSignal): Promise<void> {
    await this.requestAbortable('activate', undefined, signal);
    this.#status = 'active';
  }

  async deactivate(): Promise<void> {
    if (this.#closed || this.#status === 'failed') return;
    await this.request('deactivate');
    this.#status = 'prepared';
  }

  async call<TResult = unknown>(method: string, input?: unknown): Promise<TResult> {
    if (this.#status !== 'active') {
      throw new Error(`Isolated Plugin ${this.owner} is not accepting calls: ${this.#status}`);
    }
    assertMethod(method);
    assertCloneable(input, `Input for ${method}`);
    return this.admission.enter(() => this.request<TResult>('call', { method, input }))
      ?? Promise.reject(new Error(`Isolated Plugin ${this.owner} generation is not admitted`));
  }

  onEvent(listener: (event: IsolatedPluginEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  request<TResult = unknown>(method: RequestMessage['method'], payload?: unknown): Promise<TResult> {
    if (this.#closed) return Promise.reject(new Error(`Isolated Plugin ${this.owner} is closed`));
    const id = this.#nextRequest++;
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const error = new Error(`Isolated request timed out after ${this.timeoutMs}ms: ${method}`);
        reject(error);
        // A timed-out remote call may still mutate state. Retiring the whole
        // instance preserves the generation boundary instead of faking drain.
        this.#fail(error);
        void this.transport.close();
      }, this.timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });
      this.transport.send({ type: 'request', id, method, payload });
    });
  }

  async requestAbortable<TResult = unknown>(
    method: RequestMessage['method'],
    payload: unknown,
    signal: AbortSignal,
  ): Promise<TResult> {
    signal.throwIfAborted();
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        const reason = signal.reason instanceof Error
          ? signal.reason
          : new Error(`Isolated request aborted: ${method}`);
        this.#fail(reason);
        void this.transport.close().then(
          () => reject(reason),
          (closeError) => reject(new AggregateError(
            [reason, closeError],
            `Isolated request cancellation failed: ${method}`,
          )),
        );
      };
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await Promise.race([this.request<TResult>(method, payload), aborted]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      if (this.#status !== 'failed') await this.request('dispose');
    } finally {
      this.#closed = true;
      this.#status = 'closed';
      this.#rejectPending(new Error(`Isolated Plugin ${this.owner} closed`));
      await this.transport.close();
    }
  }

  #onMessage(message: HostMessage): void {
    if (message.type === 'response') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(deserializeError(message.error));
      return;
    }
    if (message.type === 'event') {
      this.admission.enter(() => {
        const event = Object.freeze({ name: message.name, payload: message.payload });
        for (const listener of this.#listeners) listener(event);
      });
      return;
    }
    void this.#handleHostCall(message);
  }

  async #handleHostCall(message: HostCallMessage): Promise<void> {
    try {
      const handled = this.admission.enter(async () => {
        const method = this.hostMethods[message.method];
        if (!method) throw new Error(`Host RPC method is not allowed: ${message.method}`);
        const value = await method(message.input, { owner: this.owner });
        assertCloneable(value, `Host RPC result for ${message.method}`);
        this.transport.send({ type: 'host-result', id: message.id, ok: true, value });
      });
      if (!handled) {
        throw new Error(`Isolated Plugin ${this.owner} generation is not admitted`);
      }
      await handled;
    } catch (error) {
      this.transport.send({
        type: 'host-result',
        id: message.id,
        ok: false,
        error: serializeError(error),
      });
    }
  }

  #fail(error: Error): void {
    if (this.#closed || this.#status === 'closed' || this.#status === 'failed') return;
    this.#status = 'failed';
    this.#rejectPending(error);
    this.onCrash?.(this.owner, error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function assertCloneable(value: unknown, label: string): void {
  try { structuredClone(value); }
  catch (error) { throw new TypeError(`${label} is not structured-cloneable`, { cause: error }); }
}

function assertMethod(method: string): void {
  if (!method || method === '__proto__' || method === 'constructor' || method === 'prototype') {
    throw new TypeError(`Invalid isolated RPC method: ${method}`);
  }
}
