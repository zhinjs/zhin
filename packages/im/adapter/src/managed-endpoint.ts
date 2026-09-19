import { DisposeStack } from '@zhin.js/plugin-runtime';
import { Endpoint, isEndpoint } from './endpoint.js';
import type { EndpointContentPort } from './endpoint-content.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointManagement } from './endpoint-management.js';
import type {
  EndpointActivationContext,
  EndpointCleanup,
  EndpointConnectionContext,
  EndpointEventSink,
  EndpointIdentity,
  EndpointImplementation,
  EndpointIncomingMessage,
  EndpointSendRequest,
} from './endpoint-contract.js';

interface ManagedEndpointContext {
  readonly id: EndpointIdentity['id'];
  readonly endpointId: string;
}

class ManagedEndpoint<TClient> extends Endpoint<TClient> {
  readonly client: TClient;
  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  readonly #implementation: EndpointImplementation<TClient>;
  readonly #endpointId: string;
  #activationContext?: EndpointActivationContext;
  #connectCleanup?: EndpointCleanup;
  #activationCleanup?: EndpointCleanup;
  #started = false;
  #open = false;
  #everOpened = false;
  #stopped = false;

  constructor(implementation: EndpointImplementation<TClient>, context: ManagedEndpointContext) {
    super();
    this.#implementation = implementation;
    this.#endpointId = context.endpointId;
    this.client = implementation.client;
    this.management = implementation.management;
    this.control = implementation.control;
    this.content = implementation.content;
  }

  get name(): string {
    return this.#implementation.name ?? this.#endpointId;
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.#started) return;
    if (this.#stopped) throw new Error(`Endpoint ${this.#endpointId} cannot restart after stop`);
    signal.throwIfAborted();
    const events: EndpointEventSink = Object.freeze({
      emit: <TPayload, TName extends string>(name: TName, payload: TPayload) =>
        this.#publish(name, payload),
      platform: <TEvent, TName extends string>(name: TName, event: TEvent) =>
        this.#publishPlatform(name, event),
      message: <TSegment>(input: EndpointIncomingMessage<TSegment>) =>
        this.#publishMessage(input),
    });
    const activationContext: EndpointActivationContext = Object.freeze({
      signal,
      identity: this.identity,
      events,
    });
    const stack = new DisposeStack();
    const connection: EndpointConnectionContext = Object.freeze({
      ...activationContext,
      onCleanup: (cleanup: EndpointCleanup) => { stack.add(cleanup); },
    });
    try {
      const cleanup = await this.#implementation.connect?.(connection);
      if (cleanup !== undefined && typeof cleanup !== 'function') {
        throw new TypeError(`Endpoint ${this.#endpointId} connect() must return a cleanup function`);
      }
      if (cleanup) stack.add(cleanup);
      stack.seal();
      if (signal.aborted || this.#stopped) {
        const stoppedError = signal.aborted
          ? signal.reason ?? new Error(`Endpoint ${this.#endpointId} connect aborted`)
          : new Error(`Endpoint ${this.#endpointId} stopped during connect`);
        await disposeAfterError(
          stack,
          stoppedError,
          `Endpoint ${this.#endpointId} late connect cleanup failed`,
        );
      }
    } catch (error) {
      await disposeAfterError(stack, error, `Endpoint ${this.#endpointId} connect rollback failed`);
    }
    this.#activationContext = activationContext;
    this.#connectCleanup = () => stack.dispose();
    this.#started = true;
  }

  open(): void {
    const activationContext = this.#activationContext;
    if (!this.#started || this.#stopped || !activationContext) {
      throw new Error(`Endpoint ${this.#endpointId} must connect before open`);
    }
    this.#open = true;
    try {
      const cleanup = this.#implementation.activate?.(activationContext);
      if (cleanup !== undefined && typeof cleanup !== 'function') {
        throw new TypeError(`Endpoint ${this.#endpointId} activate() must return a cleanup function`);
      }
      this.#activationCleanup = cleanup || undefined;
      this.#everOpened = true;
    } catch (error) {
      this.#open = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#open = false;
    const cleanup = this.#activationCleanup;
    this.#activationCleanup = undefined;
    await cleanup?.();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const cleanup = this.#connectCleanup;
    this.#connectCleanup = undefined;
    const errors: unknown[] = [];
    try {
      await this.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await cleanup?.();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Endpoint ${this.#endpointId} cleanup failed`);
    }
  }

  send(request: EndpointSendRequest): string | Promise<string> {
    if (!this.#implementation.send) {
      throw new Error(`Endpoint ${this.#endpointId} does not support outbound messages`);
    }
    return this.#implementation.send(request);
  }

  #canPublish(): boolean {
    if (this.#stopped) return false;
    // Candidate readiness happens before open; Endpoint's generation gate owns
    // these early events. Once close has run, new transport events are ignored.
    return this.#open || !this.#everOpened;
  }

  #publish<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown> {
    if (!this.#canPublish()) return Promise.resolve(undefined);
    return this.emit(name, payload);
  }

  #publishPlatform<TEvent, TName extends string>(name: TName, event: TEvent): Promise<unknown> {
    if (!this.#canPublish()) return Promise.resolve(undefined);
    return this.emitPlatform(name, event);
  }

  #publishMessage<TSegment>(input: EndpointIncomingMessage<TSegment>): Promise<unknown> {
    return this.#publish('message.receive', Object.freeze({
      ...input,
      conversation: Object.freeze({
        ...input.conversation,
        endpoint: this.identity,
      }),
      endpointId: input.endpointId ?? this.name,
    }));
  }
}

async function disposeAfterError(
  stack: DisposeStack,
  error: unknown,
  message: string,
): Promise<never> {
  try {
    await stack.dispose();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], message, { cause: cleanupError });
  }
  throw error;
}

/** @internal Convert the compact authoring form into the Runtime Endpoint contract. */
export function materializeEndpoint<TClient>(
  value: Endpoint<TClient> | EndpointImplementation<TClient>,
  context: ManagedEndpointContext,
): Endpoint<TClient> {
  if (isEndpoint(value)) return value as Endpoint<TClient>;
  if (!value || typeof value !== 'object' || !('client' in value)) {
    throw new TypeError(
      `Adapter ${context.id} create() must return an Endpoint or an object with a client`,
    );
  }
  if (value.client === value) {
    throw new TypeError(`Adapter Endpoint ${context.id} must expose a distinct platform client`);
  }
  return new ManagedEndpoint(value as EndpointImplementation<TClient>, context);
}

