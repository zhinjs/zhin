import { AsyncLocalStorage } from 'node:async_hooks';
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
  EndpointConversation,
  EndpointEvent,
  EndpointEventSink,
  EndpointIdentity,
  EndpointIncomingMessage,
  EndpointSendRequest,
  EndpointSendPart,
  EndpointSendResult,
  EndpointTransportState,
  PlatformEvent,
} from './endpoint-contract.js';

/** Accepted receipt authority, valid only while its owning gateway.run callback is pending. */
export interface EndpointReceipt {
  receive(event: EndpointEvent): Promise<unknown>;
}
interface InboundReceiptScope {
  /** Only this callback may admit children; draining existing children grants no new authority. */
  active: boolean;
  receipt?: EndpointReceipt;
  readonly children: Set<Promise<unknown>>;
}

/** The one inbound event boundary shared by every platform Endpoint. */
export interface EndpointEventGateway {
  /** Pin the owning Root operation across native normalization and canonical continuations. */
  run<T>(receive: (receipt: EndpointReceipt) => T | Promise<T>): Promise<T>;
  receive(event: EndpointEvent): Promise<unknown>;
  /** Read presentation language for a protocol response before normal message dispatch. */
  resolveLocale?(endpoint: EndpointIdentity, senderId?: string): Promise<Locale | undefined>;
}

/** Callback shape used by protocol normalizers which feed the framework event sink. */
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
  /** The concrete account epoch owns this signal; generation replacement does not abort it. */
  readonly signal: AbortSignal;
  use<T>(token: Token<T>): T;
}

/** Internal admission attachment; platform Endpoints implement the symbol contract. */
export abstract class EndpointRuntime<TClient = unknown> {
  readonly [endpointBrand] = true;
  /** Actual native Endpoint instance managed by this internal admission attachment. */
  abstract readonly client: TClient;

  /** Optional local transport health. Absence means unobserved, not online. */
  get transportState(): EndpointTransportState | undefined { return undefined; }

  readonly management?: EndpointManagement;
  readonly control?: EndpointControl;
  readonly content?: EndpointContentPort;

  #identity?: EndpointIdentity;
  #events?: EndpointEventGateway;
  #executionSignal!: AbortSignal;
  #admissionState: 'unbound' | 'pending' | 'active' | 'retired' = 'unbound';
  #ingressSuspended = false;
  readonly #inboundScope = new AsyncLocalStorage<InboundReceiptScope>();
  readonly #inflightInbound = new Map<Promise<unknown>, InboundReceiptScope>();
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
    this.#executionSignal = context.signal;
    if (!admission) {
      this.#activate();
      return;
    }
    this.#admissionState = 'pending';
    admission.onActivate(() => {
      if (this.#admissionState !== 'pending') return;
      this.#activate();
      admission.onDeactivate(() => this[endpointRetire]());
      if (!this.#isActive()) return;
      // A candidate may already be normalizing a native callback. First publication
      // admits that same receipt; its remaining emissions must never use a later Root.
      for (const [operation, scope] of this.#inflightInbound) {
        if (!scope.active || scope.receipt) continue;
        void events.run(receipt => { scope.receipt = receipt; return operation; }).catch(() => undefined);
        // The original operation's caller owns its failure; this holder only retains its Root.
      }
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
          const dispatched = this.runInbound(() => events.receive(entry.event));
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

  /** Retire admission before releasing transport resources. */
  retire(): void { this[endpointRetire](); }

  /** The identity is available after Adapter initialization binds this runtime. */
  get identity(): EndpointIdentity {
    if (!this.#identity) throw new Error('Endpoint is not bound to a runtime generation');
    return this.#identity;
  }

  /** Resolve trusted personal/project language for immediate protocol replies. */
  async resolveLocale(senderId?: string): Promise<Locale | undefined> {
    if (!this.#isActive() || !this.#identity) return undefined;
    return this.#events?.resolveLocale?.(this.#identity, senderId);
  }

  /** Local handoff can suspend ingress without permanently retiring the generation. */
  protected suspendIngress(): void {
    this.#ingressSuspended = true;
    for (const entry of this.#pendingEvents.splice(0)) {
      entry.reject?.(new Error('Endpoint closed before event admission'));
    }
  }
  protected resumeIngress(): void { this.#ingressSuspended = false; }

  /** One receipt scope owns normalization and all of its canonical continuations. */
  runInbound<T>(receive: () => T | Promise<T>): Promise<T> {
    return this.#receiveInbound(receive, this.#inboundScope.getStore());
  }

  #receiveInbound<T>(receive: () => T | Promise<T>, parent?: InboundReceiptScope): Promise<T> {
    if (!this.#events) throw new Error('Endpoint emitted before it was bound to a runtime generation');
    if (this.#admissionState === 'retired' && !parent?.active) return Promise.reject(new Error('Endpoint generation is retired'));
    if (this.#ingressSuspended && !parent?.active) return Promise.reject(new Error('Endpoint ingress is closed'));
    const scope: InboundReceiptScope = { active: true, receipt: parent?.active ? parent.receipt : undefined, children: new Set() };
    let result: T | Promise<T>;
    try {
      this.#executionSignal.throwIfAborted();
      const execute = () => {
        let received: T | Promise<T>;
        try {
          received = this.#inboundScope.run(scope, receive);
          const asynchronous = received != null && (typeof received === 'object' || typeof received === 'function')
            && 'then' in received && typeof received.then === 'function';
          if (!asynchronous) scope.active = false;
        }
        catch (error) { scope.active = false; received = Promise.reject(error); }
        return Promise.resolve(received).finally(async () => {
          scope.active = false;
          // Native SDK callbacks may deliberately detach a child normalizer or
          // dispatch. Its accepted descendants still belong to this Root receipt.
          // Drain without changing the callback's value/error or taking ownership
          // of failures returned to the child's original caller.
          while (scope.children.size) await Promise.allSettled([...scope.children]);
        });
      };
      // Candidate events are buffered until publication. Accepted receipts retain their Root once.
      result = parent?.active || this.#admissionState === 'pending' ? execute()
        : this.#events.run(receipt => { scope.receipt = receipt; return execute(); });
    }
    catch (error) { scope.active = false; return Promise.reject(error); }
    const operation: Promise<T> = Promise.resolve(result).finally(() => {
      scope.active = false;
      this.#inflightInbound.delete(operation);
    });
    this.#inflightInbound.set(operation, scope);
    if (parent?.active) {
      parent.children.add(operation);
      const release = () => { parent.children.delete(operation); };
      void operation.then(release, release);
    }
    return operation;
  }

  assertExternalLifecycle(operation: 'close' | 'stop'): void {
    if (this.#inboundScope.getStore()?.active) {
      throw new Error(`Endpoint ${operation} cannot run inside its own inbound receive; invoke it from the owning lifecycle`);
    }
  }

  protected async drainInbound(): Promise<void> {
    while (this.#inflightInbound.size) await Promise.allSettled([...this.#inflightInbound.keys()]);
  }

  /** The only legal platform-to-framework event ingress. */
  protected emit<TPayload, TName extends string>(
    name: TName,
    payload: TPayload,
  ): Promise<unknown> {
    return this.#publishInScope(name, payload, false);
  }

  /** Await actual generation admission and dispatch before acknowledging a platform update. */
  protected emitAccepted<TPayload, TName extends string>(name: TName, payload: TPayload): Promise<unknown> {
    return this.#publishInScope(name, payload, true);
  }

  #publishInScope<TPayload>(name: string, payload: TPayload, accepted: boolean): Promise<unknown> {
    const parent = this.#inboundScope.getStore();
    if ((this.#ingressSuspended || this.#admissionState === 'retired') && !parent?.active) {
      return this.#publish(name, payload, accepted);
    }
    return this.#receiveInbound(() => this.#publish(name, payload, accepted), parent);
  }

  #publish<TPayload, TName extends string>(name: TName, payload: TPayload, accepted: boolean): Promise<unknown> {
    if (!this.#events || !this.#identity) {
      throw new Error('Endpoint emitted before it was bound to a runtime generation');
    }
    if (this.#admissionState === 'retired' && !this.#inboundScope.getStore()?.active) return accepted
      ? Promise.reject(new Error('Endpoint generation is retired')) : Promise.resolve(undefined);
    if (this.#ingressSuspended && !this.#inboundScope.getStore()?.active) return accepted
      ? Promise.reject(new Error('Endpoint ingress is closed')) : Promise.resolve(undefined);
    this.#executionSignal.throwIfAborted();
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
    const receipt = this.#inboundScope.getStore()?.receipt;
    if (!receipt) throw new Error('Endpoint event requires an admitted receipt');
    return receipt.receive(event);
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
  endpoint: EndpointRuntime,
  context: EndpointBindingContext,
  admission?: GenerationAdmissionGate,
): void {
  endpoint[endpointBind](context, admission);
}

/** @internal Cross-generation Endpoint check that survives ESM module re-evaluation. */
export function isEndpointRuntime(value: unknown): value is EndpointRuntime {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EndpointRuntime> & {
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
