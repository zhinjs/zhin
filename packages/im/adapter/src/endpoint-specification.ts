import type { GenerationAdmissionGate } from '@zhin.js/plugin-runtime';
import { Endpoint, bindEndpoint, isEndpoint, type EndpointEventSink, type EndpointSendRequest,
  type EndpointSendResult, type EndpointTransportState } from './endpoint.js';
import type { EndpointContentPort } from './endpoint-content.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointManagement } from './endpoint-management.js';

/** Framework namespace; native SDK emit/on/off and other methods remain untouched. */
export const endpointSpec: unique symbol = Symbol.for('zhin.endpoint.specification/1');
const specificationRuntime: unique symbol = Symbol.for('zhin.endpoint.specification-runtime/1');

export interface PlatformEndpoint {
  readonly [endpointSpec]: EndpointSpecification;
}
export interface EndpointSpecification {
  readonly events: EndpointEventSink;
  reportSelfUserId(userId: string | undefined): void;
  readonly [specificationRuntime]: Endpoint;
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
class NativeEndpointRuntime extends Endpoint<object> {
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
  open(): void { this.#hooks.open(); }
  close(): void | Promise<void> { return this.#hooks.close(); }
  stop(): void | Promise<void> { return this.#hooks.stop(); }
  override send(request: EndpointSendRequest): EndpointSendResult | Promise<EndpointSendResult> {
    if (!this.#hooks.send) throw new Error('Endpoint does not support outbound');
    return this.#hooks.send(request);
  }
  publish(name: string, payload: unknown): Promise<unknown> { return this.emit(name, payload); }
  publishPlatform(name: string, event: unknown): Promise<unknown> { return this.emitPlatform(name, event); }
  report(userId: string | undefined): void { this.reportSelfUserId(userId); }
}

export function createEndpointSpecification(client: object, hooks: EndpointHooks): EndpointSpecification {
  const runtime = new NativeEndpointRuntime(client, hooks);
  return Object.freeze({
    [specificationRuntime]: runtime,
    events: Object.freeze({
      emit: (name: string, payload: unknown) => runtime.publish(name, payload),
      platform: (name: string, event: unknown) => runtime.publishPlatform(name, event),
      message: (input) => runtime.publish('message.receive', Object.freeze({
        ...input,
        conversation: Object.freeze({ ...input.conversation, endpoint: runtime.identity }),
        endpointId: input.endpointId ?? hooks.name,
      })),
    } satisfies EndpointEventSink),
    reportSelfUserId: (userId: string | undefined) => runtime.report(userId),
  });
}

/** Legacy class inputs and native specifications share the same admission implementation. */
export type AnyEndpoint = PlatformEndpoint | Endpoint;
export function isPlatformEndpoint(value: unknown): value is PlatformEndpoint {
  return !!value && typeof value === 'object' && endpointSpec in value
    && isEndpoint((value as PlatformEndpoint)[endpointSpec]?.[specificationRuntime]);
}
export function endpointRuntimeOf(endpoint: AnyEndpoint): Endpoint {
  return isEndpoint(endpoint) ? endpoint : endpoint[endpointSpec][specificationRuntime];
}
export function endpointClientOf<E extends AnyEndpoint>(endpoint: E): E extends Endpoint<infer C> ? C : E {
  return (isEndpoint(endpoint) ? endpoint.client : endpoint) as E extends Endpoint<infer C> ? C : E;
}
export function bindPlatformEndpoint(endpoint: AnyEndpoint, ...args: [Parameters<typeof bindEndpoint>[1], GenerationAdmissionGate?]): void {
  bindEndpoint(endpointRuntimeOf(endpoint), ...args);
}
