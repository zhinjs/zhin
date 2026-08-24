import {
  createToken,
  type CapabilityId,
  type GenerationAdmissionGate,
} from '@zhin.js/plugin-runtime';
import type { AdapterContext, EndpointSendRequest } from './definition.js';
import type { EndpointManagement } from './endpoint-management.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointContentPort } from './endpoint-content.js';

/** The one inbound event boundary shared by every platform Endpoint. */
export interface EndpointEventGateway {
  receive(event: EndpointEvent): Promise<unknown>;
}

/** Callback shape used by protocol normalizers which feed Endpoint.emit(). */
export type EndpointEventEmitter = <TPayload>(name: string, payload: TPayload) => Promise<unknown>;

/** Generation-bound gateway injected into Endpoint by AdapterIndex. */
export const endpointEventGatewayToken = createToken<EndpointEventGateway>(
  'zhin.adapter.endpoint-events',
);

/** Stable identity of the Endpoint which produced an event. */
export interface EndpointIdentity {
  readonly id: CapabilityId;
  readonly adapter: string;
}

/**
 * The single event context delivered from an Endpoint into Core and plugins.
 * `client` is the actual platform SDK/protocol client owned by the Endpoint.
 */
export interface EndpointEvent<
  TPayload = unknown,
  TClient = unknown,
  TName extends string = string,
> {
  readonly name: TName;
  readonly payload: TPayload;
  readonly endpoint: EndpointIdentity;
  readonly client: TClient;
}

/** Lossless native event delivered before any optional canonical projection. */
export interface PlatformEvent<
  TEvent = unknown,
  TName extends string = string,
> {
  /** Native SDK/protocol event name, for example `guild_member_add`. */
  readonly name: TName;
  /** Native SDK/protocol payload without canonicalization. */
  readonly event: TEvent;
}

const endpointBrand = Symbol.for('zhin.adapter.endpoint/1');
const endpointBind = Symbol.for('zhin.adapter.endpoint-bind/1');
const PRE_ADMISSION_EVENT_LIMIT = 256;

/**
 * Deep platform boundary.
 *
 * Platform implementations inherit this class, expose the platform-native
 * `client`, own account/transport lifecycle, and normalize every inbound SDK
 * callback through `emit()`. Core owns dispatch, admission and plugin context.
 */
export abstract class Endpoint<TClient = unknown> {
  readonly [endpointBrand] = true;
  /**
   * Platform SDK or protocol client exposed to plugin code.
   * It must be a distinct object: Endpoint owns framework lifecycle, Client
   * owns platform operations.
   */
  abstract readonly client: TClient;

  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  #identity?: EndpointIdentity;
  #events?: EndpointEventGateway;
  #admissionState: 'unbound' | 'pending' | 'active' | 'retired' = 'unbound';
  #pendingEvents: EndpointEvent[] = [];

  /** @internal Bound exactly once by the generation-owned AdapterIndex. */
  [endpointBind](context: AdapterContext, admission?: GenerationAdmissionGate): void {
    if (this.#events) throw new Error(`Endpoint ${context.id} is already bound`);
    this.#identity = Object.freeze({ id: context.id, adapter: context.name });
    this.#events = context.use(endpointEventGatewayToken);
    if (!admission) {
      this.#admissionState = 'active';
      return;
    }
    this.#admissionState = 'pending';
    admission.onActivate(() => {
      if (this.#admissionState !== 'pending') return;
      this.#admissionState = 'active';
      admission.onDeactivate(() => {
        this.#admissionState = 'retired';
        this.#pendingEvents.length = 0;
      });
      const pending = this.#pendingEvents.splice(0);
      for (const event of pending) {
        void this.#events?.receive(event).catch(() => undefined);
      }
    });
  }

  /** The identity is available after AdapterDefinition.create returns. */
  get identity(): EndpointIdentity {
    if (!this.#identity) throw new Error('Endpoint is not bound to a runtime generation');
    return this.#identity;
  }

  /** The only legal platform-to-framework event ingress. */
  protected emit<TPayload, TName extends string>(
    name: TName,
    payload: TPayload,
  ): Promise<unknown> {
    if (!this.#events || !this.#identity) {
      throw new Error('Endpoint emitted before it was bound to a runtime generation');
    }
    const event = Object.freeze({
      name,
      payload,
      endpoint: this.#identity,
      client: this.client,
    });
    if (this.#admissionState === 'pending') {
      if (this.#pendingEvents.length >= PRE_ADMISSION_EVENT_LIMIT) {
        this.#pendingEvents.shift();
      }
      this.#pendingEvents.push(event);
      return Promise.resolve(undefined);
    }
    if (this.#admissionState === 'retired') return Promise.resolve(undefined);
    return this.#events.receive(event);
  }

  /**
   * Lossless native-event projection. Adapters call this before deriving
   * message/notice/request/system events, including for unknown event kinds.
   */
  protected emitPlatform<TEvent, TName extends string>(
    name: TName,
    event: TEvent,
  ): Promise<unknown> {
    return this.emit('platform.receive', Object.freeze({ name, event }));
  }

  abstract start(signal: AbortSignal): void | Promise<void>;
  abstract open(): void;
  abstract close(): void | Promise<void>;
  abstract stop(): void | Promise<void>;
  send?(_request: EndpointSendRequest): string | Promise<string>;
}

/** @internal AdapterIndex binding hook; deliberately not exported by name. */
export function bindEndpoint(
  endpoint: Endpoint,
  context: AdapterContext,
  admission?: GenerationAdmissionGate,
): void {
  endpoint[endpointBind](context, admission);
}

/** @internal Cross-generation Endpoint check that survives ESM module re-evaluation. */
export function isEndpoint(value: unknown): value is Endpoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Endpoint> & {
    readonly [endpointBrand]?: unknown;
    readonly [endpointBind]?: unknown;
  };
  return candidate[endpointBrand] === true
    && typeof candidate[endpointBind] === 'function'
    && typeof candidate.start === 'function'
    && typeof candidate.open === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.stop === 'function'
    && 'client' in candidate;
}
