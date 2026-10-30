import type { GenerationAdmissionGate } from '@zhin.js/plugin-runtime';
import { EndpointRuntime, bindEndpoint, isEndpointRuntime, type EndpointEventSink, type EndpointSendRequest,
  type EndpointSendResult, type EndpointTransportState } from './endpoint.js';
import type { EndpointContentPort } from './endpoint-content.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointManagement } from './endpoint-management.js';

/** Framework namespace; native SDK emit/on/off and other methods remain untouched. */
export const endpointSpec: unique symbol = Symbol.for('zhin.endpoint.specification/1');
const specificationRuntime: unique symbol = Symbol.for('zhin.endpoint.specification-runtime/1');

export interface Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
}
export interface EndpointSpecification {
  readonly events: EndpointEventSink;
  readonly identity: import('./endpoint-contract.js').EndpointIdentity;
  resolveLocale(senderId?: string): Promise<import('@zhin.js/plugin-runtime').Locale | undefined>;
  reportSelfUserId(userId: string | undefined): void;
  readonly [specificationRuntime]: EndpointRuntime;
}
export interface EndpointHooks {
  start(signal: AbortSignal): void | Promise<void>;
  open(): void;
  close(): void | Promise<void>;
  stop(): void | Promise<void>;
  send?(request: EndpointSendRequest): EndpointSendResult | Promise<EndpointSendResult>;
  readonly name?: string;
  readonly transportState?: EndpointTransportState;
  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;
}

/** Admission attachment only: the actual Endpoint remains the native SDK instance. */
class NativeEndpointRuntime extends EndpointRuntime<object> {
  readonly client: object;
  readonly #hooks: EndpointHooks;
  constructor(client: object, hooks: EndpointHooks) {
    super();
    this.client = client;
    this.#hooks = hooks;
    this.management = hooks.management;
    this.control = hooks.control;
    Object.defineProperty(this, 'content', { get: () => hooks.content });
    if (!hooks.send) Object.defineProperty(this, 'send', { value: undefined });
  }
  get name(): string | undefined { return this.#hooks.name; }
  override get transportState(): EndpointTransportState | undefined { return this.#hooks.transportState; }
  override readonly management?: EndpointManagement;
  override readonly control?: EndpointControl;
  start(signal: AbortSignal): void | Promise<void> { return this.#hooks.start(signal); }
  open(): void { this.resumeIngress(); this.#hooks.open(); }
  async close(): Promise<void> {
    this.assertExternalLifecycle('close');
    this.suspendIngress();
    try { await this.#hooks.close(); }
    finally { await this.drainInbound(); }
  }
  async stop(): Promise<void> {
    this.assertExternalLifecycle('stop');
    await this.drainInbound();
    await this.#hooks.stop();
  }
  override send(request: EndpointSendRequest): EndpointSendResult | Promise<EndpointSendResult> {
    if (!this.#hooks.send) throw new Error('Endpoint does not support outbound');
    return this.#hooks.send(request);
  }
  publish(name: string, payload: unknown): Promise<unknown> { return this.emit(name, payload); }
  publishAccepted(name: string, payload: unknown): Promise<unknown> { return this.emitAccepted(name, payload); }
  publishPlatform(name: string, event: unknown): Promise<unknown> { return this.emitPlatform(name, event); }
  report(userId: string | undefined): void { this.reportSelfUserId(userId); }
}

export function createEndpointSpecification(client: object, hooks: EndpointHooks): EndpointSpecification {
  const runtime = new NativeEndpointRuntime(client, hooks);
  return Object.freeze({
    [specificationRuntime]: runtime,
    get identity() { return runtime.identity; },
    resolveLocale: (senderId?: string) => runtime.resolveLocale(senderId),
    events: Object.freeze({
      run: <T>(receive: () => T | Promise<T>) => runtime.runInbound(receive),
      emit: (name: string, payload: unknown) => runtime.publish(name, payload),
      emitAccepted: (name: string, payload: unknown) => runtime.publishAccepted(name, payload),
      platform: (name: string, event: unknown) => runtime.publishPlatform(name, event),
      message: (input) => {
        const conversation = Object.freeze({ ...input.conversation, endpoint: runtime.identity });
        return runtime.publish('message.receive', Object.freeze({
          ...input, conversation,
          ...(input.message ? { message: Object.freeze({ ...input.message, conversation }) } : {}),
          endpointId: input.endpointId ?? hooks.name,
        }));
      },
    } satisfies EndpointEventSink),
    reportSelfUserId: (userId: string | undefined) => runtime.report(userId),
  });
}

/** All runtime participants are actual platform Client instances. */
export type AnyEndpoint = Endpoint;
export function isEndpoint(value: unknown): value is Endpoint {
  return !!value && typeof value === 'object' && endpointSpec in value
    && isEndpointRuntime((value as Endpoint)[endpointSpec]?.[specificationRuntime]);
}
export function endpointRuntimeOf(endpoint: Endpoint): EndpointRuntime {
  return endpoint[endpointSpec][specificationRuntime];
}
export function retireEndpoint(endpoint: Endpoint): void { endpointRuntimeOf(endpoint).retire(); }
export function bindPlatformEndpoint(endpoint: AnyEndpoint, ...args: [Parameters<typeof bindEndpoint>[1], GenerationAdmissionGate?]): void {
  bindEndpoint(endpointRuntimeOf(endpoint), ...args);
}
