import {
  createToken,
  type GenerationAdmissionGate,
  type Locale,
  type Token,
} from '@zhin.js/plugin-runtime';
import { getLogger } from '@zhin.js/logger';
import type {
  EndpointEvent,
  EndpointIdentity,
  EndpointSendRequest,
  EndpointSendResult,
  EndpointTransportState,
} from './endpoint-contract.js';
import { getProcessPeerRegistry } from './peer-registry.js';
import type { EndpointManagement } from './endpoint-management.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointContentPort } from './endpoint-content.js';

export type {
  EndpointActivationContext,
  EndpointCleanup,
  EndpointConnectionContext,
  EndpointConversation,
  EndpointEvent,
  EndpointEventSink,
  EndpointIdentity,
  EndpointImplementation,
  EndpointIncomingMessage,
  EndpointSendRequest,
  EndpointSendPart,
  EndpointSendResult,
  EndpointTransportState,
  PlatformEvent,
} from './endpoint-contract.js';

/** The one inbound event boundary shared by every platform Endpoint. */
export interface EndpointEventGateway {
  receive(event: EndpointEvent): Promise<unknown>;
  /** Read presentation language for a protocol response before normal message dispatch. */
  resolveLocale?(endpoint: EndpointIdentity, senderId?: string): Promise<Locale | undefined>;
}

/** Callback shape used by protocol normalizers which feed Endpoint.emit(). */
export type EndpointEventEmitter = <TPayload>(name: string, payload: TPayload) => Promise<unknown>;

/** Generation-bound gateway injected into Endpoint by AdapterIndex. */
export const endpointEventGatewayToken = createToken<EndpointEventGateway>(
  'zhin.adapter.endpoint-events',
);

const endpointBrand = Symbol.for('zhin.adapter.endpoint/1');
const endpointBind = Symbol.for('zhin.adapter.endpoint-bind/1');
const endpointRetire = Symbol.for('zhin.adapter.endpoint-retire/1');
const PRE_ADMISSION_EVENT_LIMIT = 256;
const endpointLogger = getLogger('adapter.endpoint');

function normalizeSelfUserId(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? normalizeSelfUserId(String(value)) : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Minimal Runtime capability needed to bind an Endpoint to one generation. */
interface EndpointBindingContext {
  readonly id: EndpointIdentity['id'];
  readonly name: string;
  use<T>(token: Token<T>): T;
}

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

  /** Optional local transport health. Absence means unobserved, not online. */
  get transportState(): EndpointTransportState | undefined { return undefined; }

  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  #identity?: EndpointIdentity;
  #events?: EndpointEventGateway;
  #admissionState: 'unbound' | 'pending' | 'active' | 'retired' = 'unbound';
  #pendingEvents: Array<{ event: EndpointEvent; resolve?: (value: unknown) => void; reject?: (error: Error) => void }> = [];
  #droppedEvents = 0;
  #dispatchFailures = 0;
  #selfUserId?: string;
  #registryRelease?: () => void;

  /**
   * 登录后的平台账号 id（运行期事实，不属于不可变的 identity）。
   * 未上报为 undefined；绝不由配置 id 兜底。
   */
  get selfUserId(): string | undefined { return this.#selfUserId; }

  /** Adapter 在登录成功后上报平台账号；undefined / 空 / 非法值表示撤销。 */
  protected reportSelfUserId(userId: string | undefined): void {
    this.#selfUserId = normalizeSelfUserId(userId);
    this.#syncPeerRegistry();
  }

  /** Re-reads the state so TS does not keep a stale narrowing across calls that mutate it. */
  #isActive(): boolean { return this.#admissionState === 'active'; }

  #activate(): void {
    this.#admissionState = 'active';
    getProcessPeerRegistry().reserve(this);
    this.#syncPeerRegistry();
  }

  #syncPeerRegistry(): void {
    this.#registryRelease?.();
    this.#registryRelease = undefined;
    if (this.#admissionState !== 'active' || !this.#selfUserId || !this.#identity) return;
    this.#registryRelease = getProcessPeerRegistry().registerEndpoint(this, {
      endpointId: this.#identity.id,
      adapter: this.#identity.adapter,
      selfUserId: this.#selfUserId,
    });
  }

  /** Payload-free counters for bounded candidate buffering and delivery errors. */
  get eventDiagnostics(): Readonly<{ buffered: number; dropped: number; dispatchFailures: number }> {
    return Object.freeze({ buffered: this.#pendingEvents.length, dropped: this.#droppedEvents,
      dispatchFailures: this.#dispatchFailures });
  }

  /** @internal Bound exactly once by the generation-owned AdapterIndex. */
  [endpointBind](context: EndpointBindingContext, admission?: GenerationAdmissionGate): void {
    if (this.#events) throw new Error(`Endpoint ${context.id} is already bound`);
    this.#identity = Object.freeze({ id: context.id, adapter: context.name });
    const events = context.use(endpointEventGatewayToken);
    this.#events = events;
    if (!admission) {
      this.#activate();
      return;
    }
    this.#admissionState = 'pending';
    admission.onActivate(() => {
      if (this.#admissionState !== 'pending') return;
      this.#activate();
      admission.onDeactivate(() => this[endpointRetire]());
      const pending = this.#pendingEvents.splice(0);
      for (const entry of pending) {
        if (!this.#isActive()) {
          entry.reject?.(new Error('Endpoint generation retired before event admission'));
          continue;
        }
        const fail = () => {
          entry.reject?.(new Error('Endpoint buffered event dispatch failed'));
          this.#dispatchFailures += 1;
          if (this.#dispatchFailures === 1) {
            endpointLogger.warn('Candidate event dispatch failed', { endpoint: this.#identity?.id });
          }
        };
        try {
          // Enter the gateway synchronously: its generation lease must be acquired
          // before retirement can make an unadmitted event look successful.
          const dispatched = events.receive(entry.event);
          void Promise.resolve(dispatched).then(entry.resolve).catch(fail);
        } catch {
          fail();
        }
      }
    });
  }

  /** @internal Reject uncommitted reliable events on candidate rollback/retirement. */
  [endpointRetire](): void {
    this.#admissionState = 'retired';
    this.#registryRelease?.();
    this.#registryRelease = undefined;
    for (const entry of this.#pendingEvents.splice(0)) {
      entry.reject?.(new Error('Endpoint generation retired before event admission'));
    }
  }

  /** The identity is available after AdapterDefinition.create returns. */
  get identity(): EndpointIdentity {
    if (!this.#identity) throw new Error('Endpoint is not bound to a runtime generation');
    return this.#identity;
  }

  /** Resolve trusted personal/project language for immediate protocol replies. */
  async resolveLocale(senderId?: string): Promise<Locale | undefined> {
    if (!this.#isActive() || !this.#identity) return undefined;
    return this.#events?.resolveLocale?.(this.#identity, senderId);
  }

  /** The only legal platform-to-framework event ingress. */
  protected emit<TPayload, TName extends string>(
    name: TName,
    payload: TPayload,
  ): Promise<unknown> {
    return this.#publish(name, payload, false);
  }

  /** Await actual generation admission and dispatch before acknowledging a platform update. */
  protected emitAccepted<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown> {
    return this.#publish(name, payload, true);
  }

  #publish<TPayload, TName extends string>(name: TName, payload: TPayload, accepted: boolean): Promise<unknown> {
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
        const dropped = this.#pendingEvents.shift();
        dropped?.reject?.(new Error('Endpoint candidate event buffer overflow'));
        this.#droppedEvents += 1;
        if (this.#droppedEvents === 1) {
          endpointLogger.warn('Candidate event buffer overflow', { endpoint: this.#identity.id, limit: PRE_ADMISSION_EVENT_LIMIT });
        }
      }
      if (accepted) return new Promise((resolve, reject) => {
        this.#pendingEvents.push({ event, resolve, reject });
      });
      this.#pendingEvents.push({ event });
      return Promise.resolve(undefined);
    }
    if (this.#admissionState === 'retired') return accepted
      ? Promise.reject(new Error('Endpoint generation is retired')) : Promise.resolve(undefined);
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
  send?(_request: EndpointSendRequest): EndpointSendResult | Promise<EndpointSendResult>;
}

/** @internal AdapterIndex binding hook; deliberately not exported by name. */
export function bindEndpoint(
  endpoint: Endpoint,
  context: EndpointBindingContext,
  admission?: GenerationAdmissionGate,
): void {
  endpoint[endpointBind](context, admission);
}

/** @internal Called before releasing transport resources on rollback/stop. */
export function retireEndpoint(endpoint: Endpoint): void { endpoint[endpointRetire](); }

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
