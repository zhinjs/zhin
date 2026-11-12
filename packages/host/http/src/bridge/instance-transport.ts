/**
 * Gateway side of the HTTP bridge (ADR 0054 §3): {@link InstanceTransport} is what the gateway's
 * HTTP server codes against; {@link IpcInstanceTransport} implements it over the instance's IPC
 * control channel. The gateway authenticates, then forwards the Web `Request` (with the
 * principal) and gets a streamed `Response` back; WebSockets are bridged frame by frame.
 *
 * Nothing here imports `node:http` or `ws`; the gateway converts its Node server objects to
 * `Request` / `WsConnection` itself.
 */
import type { ConsolePluginPermissionInfo } from '@zhin.js/console-protocol';
import type { ConsoleAuditEntry, ConsolePrincipal } from '../access-control.js';
import type { WsConnection } from '../http-host.js';
import type { HttpHostAddress } from '../host-options.js';
import { sendableCloseCode } from './bridged-host.js';
import { BridgeStreamClosedError, CreditGate, InboundBody, ownBytes, pumpBody } from './flow.js';
import {
  DEFAULT_BRIDGE_LIMITS,
  DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS,
  DEFAULT_BRIDGE_WS_OPEN_TIMEOUT_MS,
  EMPTY_ROUTE_TABLE,
  fromBridgeHeaders,
  headSize,
  isBridgeProtocolCompatible,
  parseInstanceMessage,
  toBridgeHeaders,
  wsMessageSize,
  type BridgeLimits,
  type BridgeRouteTable,
  type GatewayToInstanceMessage,
  type HttpResponseHeadPayload,
  type InstanceToGatewayMessage,
} from './protocol.js';

/** Per-request data the gateway resolved before forwarding. */
export interface InstanceRequestContext {
  /**
   * Principal the gateway authenticated. Required for `{apiBase}` routes (else the instance
   * answers 401); for other routes pass it when the caller presented a valid credential.
   */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

/** An upgrade request the gateway wants the instance to accept. */
export interface InstanceWsOpenInfo {
  readonly url: URL;
  readonly headers: Headers;
  /** Required for `auth: 'host'` sockets (see {@link BridgeRouteTable.ws}). */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

/**
 * @public What the gateway's HTTP server talks to (B1.3 codes against this).
 *
 * - `ready`: the instance announced its route table and accepts requests; false before that,
 *   after the instance exited, or when it speaks an incompatible protocol.
 * - `routes()` / `onRoutes()`: the current table; listeners run on every new table (hot reload,
 *   generation switch) and with {@link EMPTY_ROUTE_TABLE} when the instance goes away.
 * - `fetch()`: forwards one request. The request body is streamed with backpressure; aborting
 *   `request.signal` cancels the exchange in the instance. Resolves with the instance's
 *   `Response` (body streamed with backpressure; cancelling it cancels the instance side).
 *   Rejects with {@link InstanceTransportError}: `instance-offline` (not ready / went away
 *   before the head), `timeout` (no head in time), `instance-error` (failed before the head),
 *   `overloaded` (too many streams), or with `request.signal.reason` when aborted.
 * - `openWebSocket()`: `peer` is the gateway's accepted client socket. Resolves true once the
 *   instance accepted (frames then flow both ways, closes propagate); false when it rejected,
 *   timed out or is offline: the caller then closes `peer`. Peer frames sent before acceptance
 *   are queued.
 */
export interface InstanceTransport {
  readonly ready: boolean;
  routes(): BridgeRouteTable;
  onRoutes(listener: (table: BridgeRouteTable) => void): () => void;
  fetch(request: Request, context?: InstanceRequestContext): Promise<Response>;
  openWebSocket(info: InstanceWsOpenInfo, peer: WsConnection): Promise<boolean>;
}

export type InstanceTransportErrorCode = 'instance-offline' | 'timeout' | 'instance-error' | 'overloaded';

export class InstanceTransportError extends Error {
  constructor(readonly code: InstanceTransportErrorCode, message: string) {
    super(message);
    this.name = 'InstanceTransportError';
  }
}

/** The gateway's end of the IPC channel to the current instance child. */
export interface GatewayInstancePort {
  send(message: GatewayToInstanceMessage): void;
}

/** The subset of `ChildProcess` {@link IpcInstanceTransport.attachChildProcess} needs. */
export interface InstanceChildProcessLike {
  send?(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit' | 'disconnect', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'exit' | 'disconnect', listener: () => void): unknown;
}

export interface IpcInstanceTransportOptions {
  readonly limits?: Partial<BridgeLimits>;
  /** Time to wait for a response head. Default {@link DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS}. */
  readonly responseTimeoutMs?: number;
  /** Time to wait for `ws.accepted`. Default {@link DEFAULT_BRIDGE_WS_OPEN_TIMEOUT_MS}. */
  readonly wsOpenTimeoutMs?: number;
  /** Client socket backlog below which instance frames are acknowledged. Default 1 MiB. */
  readonly wsLowWaterBytes?: number;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const DRAIN_POLL_MS = 20;

interface PendingExchange {
  readonly method: string;
  readonly gate: CreditGate;
  readonly abort: AbortController;
  settleHead(head: HttpResponseHeadPayload | Error): void;
  body?: InboundBody;
  headReceived: boolean;
}

interface BridgedPeer {
  readonly peer: WsConnection;
  /** Sends a peer frame to the instance (after acceptance). */
  forward(data: string | Uint8Array): void;
  accepted: boolean;
  closed: boolean;
  /** Bytes sent to the instance and not acknowledged yet. */
  unacked: number;
  /** Instance bytes delivered to the peer and not acknowledged yet. */
  pendingAck: number;
  drainTimer?: ReturnType<typeof setInterval>;
  readonly queue: (string | Uint8Array)[];
  settle(accepted: boolean): void;
  /** Instance went away or closed: close the peer. */
  closePeer(code: number, reason: string): void;
  cleanup(): void;
}

export class IpcInstanceTransport implements InstanceTransport {
  readonly #limits: BridgeLimits;
  /** Survives restarts: the last catalog the instance reported (plugins rarely change). */
  #catalog: readonly ConsolePluginPermissionInfo[] = Object.freeze([]);
  readonly #catalogListeners = new Set<(catalog: readonly ConsolePluginPermissionInfo[]) => void>();
  readonly #auditListeners = new Set<(entry: ConsoleAuditEntry) => void>();
  readonly #responseTimeoutMs: number;
  readonly #wsOpenTimeoutMs: number;
  readonly #wsLowWater: number;
  #port: GatewayInstancePort | undefined;
  #table: BridgeRouteTable = EMPTY_ROUTE_TABLE;
  #tableReceived = false;
  #incompatible = false;
  #addresses: readonly HttpHostAddress[] | undefined;
  #sequence = 0;
  readonly #exchanges = new Map<string, PendingExchange>();
  readonly #peers = new Map<string, BridgedPeer>();
  readonly #routeListeners = new Set<(table: BridgeRouteTable) => void>();

  constructor(options: IpcInstanceTransportOptions = {}) {
    this.#limits = Object.freeze({ ...DEFAULT_BRIDGE_LIMITS, ...options.limits });
    this.#responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS;
    this.#wsOpenTimeoutMs = options.wsOpenTimeoutMs ?? DEFAULT_BRIDGE_WS_OPEN_TIMEOUT_MS;
    this.#wsLowWater = options.wsLowWaterBytes ?? 1024 * 1024;
  }

  /** Plugin permission catalog the instance last reported (kept across restarts). */
  pluginPermissions(): readonly ConsolePluginPermissionInfo[] {
    return this.#catalog;
  }

  onCatalog(listener: (catalog: readonly ConsolePluginPermissionInfo[]) => void): () => void {
    this.#catalogListeners.add(listener);
    return () => { this.#catalogListeners.delete(listener); };
  }

  /** Audit entries the instance wrote (the gateway owns the audit log). */
  onAudit(listener: (entry: ConsoleAuditEntry) => void): () => void {
    this.#auditListeners.add(listener);
    return () => { this.#auditListeners.delete(listener); };
  }

  /** Tells the instance to close the live connections of `principalId` (a user id). */
  revokePrincipal(principalId: string, reason?: string): void {
    if (!principalId) return;
    this.#send({ type: 'principal-revoked', payload: { principalId, ...(reason ? { reason: reason.slice(0, 64) } : {}) } });
  }

  get ready(): boolean {
    return this.#port !== undefined && this.#tableReceived && !this.#incompatible;
  }

  get activeStreams(): number {
    return this.#exchanges.size + this.#peers.size;
  }

  routes(): BridgeRouteTable {
    return this.ready ? this.#table : EMPTY_ROUTE_TABLE;
  }

  onRoutes(listener: (table: BridgeRouteTable) => void): () => void {
    this.#routeListeners.add(listener);
    return () => { this.#routeListeners.delete(listener); };
  }

  /** Addresses the gateway listens on; forwarded to the instance (`HttpHost.address`). */
  setAddresses(addresses: readonly HttpHostAddress[]): void {
    this.#addresses = Object.freeze(addresses.map((address) => ({ ...address })));
    this.#send({ type: 'host.addresses', payload: { addresses: this.#addresses } });
  }

  /** Binds the transport to a new instance child; an earlier one is detached first. */
  attach(port: GatewayInstancePort): void {
    if (this.#port) this.detach('Instance replaced');
    this.#port = port;
    this.#table = EMPTY_ROUTE_TABLE;
    this.#tableReceived = false;
    this.#incompatible = false;
    if (this.#addresses) this.#send({ type: 'host.addresses', payload: { addresses: this.#addresses } });
  }

  /**
   * Wires a spawned child (`serialization: 'advanced'`): its messages feed {@link receive},
   * `exit` / `disconnect` detach. Returns the unwiring function.
   */
  attachChildProcess(child: InstanceChildProcessLike): () => void {
    const port: GatewayInstancePort = {
      send(message) {
        try {
          child.send?.(message, () => undefined);
        } catch { /* channel closed */ }
      },
    };
    const onMessage = (raw: unknown): void => { if (this.#port === port) this.receive(raw); };
    const onGone = (): void => { if (this.#port === port) this.detach('Instance exited'); };
    this.attach(port);
    child.on('message', onMessage);
    child.on('exit', onGone);
    child.on('disconnect', onGone);
    return () => {
      child.off('message', onMessage);
      child.off('exit', onGone);
      child.off('disconnect', onGone);
      onGone();
    };
  }

  /** The instance is gone: fail every exchange and close every bridged socket. */
  detach(reason = 'Instance offline'): void {
    if (!this.#port) return;
    const wasReady = this.ready;
    this.#port = undefined;
    this.#tableReceived = false;
    for (const [id, exchange] of [...this.#exchanges]) {
      this.#exchanges.delete(id);
      const error = new InstanceTransportError('instance-offline', reason);
      exchange.gate.close(error);
      exchange.abort.abort(error);
      exchange.settleHead(error);
      exchange.body?.fail(error);
    }
    for (const peer of [...this.#peers.values()]) {
      peer.settle(false);
      peer.closePeer(1012, 'Instance restarting');
    }
    this.#table = EMPTY_ROUTE_TABLE;
    if (wasReady) this.#emitRoutes();
  }

  /** Feeds one raw message from the instance. Unknown / malformed messages are ignored. */
  receive(raw: unknown): void {
    const message = parseInstanceMessage(raw, this.#limits);
    if (message) this.#dispatch(message);
  }

  // ---- HTTP

  async fetch(request: Request, context: InstanceRequestContext = {}): Promise<Response> {
    request.signal.throwIfAborted();
    if (!this.ready) throw new InstanceTransportError('instance-offline', 'Instance is offline');
    if (this.activeStreams >= this.#limits.maxStreams) throw new InstanceTransportError('overloaded', 'Too many concurrent instance streams');
    const headers = toBridgeHeaders(request.headers);
    if (headSize(request.url, headers) > this.#limits.maxHeadBytes) return new Response(null, { status: 431 });
    const id = `h${++this.#sequence}`;
    let settleHead!: (head: HttpResponseHeadPayload | Error) => void;
    const head = new Promise<HttpResponseHeadPayload | Error>((resolve) => { settleHead = resolve; });
    const exchange: PendingExchange = {
      method: request.method.toUpperCase(),
      gate: new CreditGate(this.#limits.initialCreditBytes),
      abort: new AbortController(),
      settleHead: (value) => { settleHead(value); },
      headReceived: false,
    };
    this.#exchanges.set(id, exchange);
    const hasBody = request.body !== null;
    this.#send({
      type: 'http.request',
      id,
      payload: {
        method: request.method,
        url: request.url,
        headers,
        body: hasBody,
        ...(context.principal ? { principal: context.principal } : {}),
        ...(context.remoteAddress ? { remoteAddress: context.remoteAddress } : {}),
      },
    });
    const onClientAbort = (): void => { this.#cancelExchange(id, request.signal.reason, 'Client aborted'); };
    request.signal.addEventListener('abort', onClientAbort, { once: true });
    exchange.abort.signal.addEventListener('abort', () => request.signal.removeEventListener('abort', onClientAbort), { once: true });
    const timer = setTimeout(() => {
      this.#cancelExchange(id, new InstanceTransportError('timeout', `Instance did not answer within ${this.#responseTimeoutMs} ms`), 'Gateway timeout');
    }, this.#responseTimeoutMs);
    timer.unref?.();
    if (hasBody) {
      void pumpBody(request.body!, {
        gate: exchange.gate,
        maxChunkBytes: this.#limits.maxChunkBytes,
        signal: exchange.abort.signal,
        send: (chunk) => this.#send({ type: 'http.request.body', id, payload: { chunk } }),
      }).then(() => {
        if (this.#exchanges.get(id) === exchange) this.#send({ type: 'http.request.end', id, payload: {} });
      }, (error: unknown) => {
        if (error instanceof BridgeStreamClosedError || exchange.abort.signal.aborted) return;
        this.#cancelExchange(id, error, 'Request body failed');
      });
    }
    const result = await head;
    clearTimeout(timer);
    if (result instanceof Error) throw result;
    // The body (created with the head, see #dispatch) may already hold chunks or have ended.
    return new Response(exchange.body?.stream ?? null, {
      status: result.status,
      ...(result.statusText ? { statusText: result.statusText } : {}),
      headers: fromBridgeHeaders(result.headers),
    });
  }

  #cancelExchange(id: string, reason: unknown, message: string): void {
    const exchange = this.#exchanges.get(id);
    if (!exchange) return;
    this.#exchanges.delete(id);
    const error = reason instanceof Error ? reason : new Error(message);
    exchange.gate.close(new BridgeStreamClosedError(message));
    exchange.abort.abort(error);
    exchange.settleHead(toError(reason, message));
    exchange.body?.fail(error);
    this.#send({ type: 'http.request.abort', id, payload: { message: message.slice(0, 256) } });
  }

  #finishExchange(id: string): void {
    const exchange = this.#exchanges.get(id);
    if (!exchange) return;
    this.#exchanges.delete(id);
    // Stop a request body the instance no longer reads.
    exchange.gate.close(new BridgeStreamClosedError('Exchange finished'));
    exchange.abort.abort(new BridgeStreamClosedError('Exchange finished'));
  }

  // ---- WebSocket

  openWebSocket(info: InstanceWsOpenInfo, peer: WsConnection): Promise<boolean> {
    if (!this.ready || this.activeStreams >= this.#limits.maxStreams) return Promise.resolve(false);
    const headers = toBridgeHeaders(info.headers);
    if (headSize(info.url.href, headers) > this.#limits.maxHeadBytes) return Promise.resolve(false);
    const id = `w${++this.#sequence}`;
    const limits = this.#limits;
    let resolveOpen!: (accepted: boolean) => void;
    const opened = new Promise<boolean>((resolve) => { resolveOpen = resolve; });
    const unsubscribe: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queuedBytes = 0;
    const state: BridgedPeer = {
      peer,
      forward: (data) => {
        const size = wsMessageSize(data);
        if (state.unacked + size > limits.maxWsBufferedBytes) {
          this.#send({ type: 'ws.close', id, payload: { code: 1013, reason: 'Instance backpressure' } });
          state.closePeer(1013, 'Instance backpressure');
          return;
        }
        state.unacked += size;
        this.#send({ type: 'ws.message', id, payload: { data: typeof data === 'string' ? data : ownBytes(data) } });
      },
      accepted: false,
      closed: false,
      unacked: 0,
      pendingAck: 0,
      queue: [],
      settle: (accepted) => {
        clearTimeout(timer);
        timer = undefined;
        resolveOpen(accepted);
      },
      closePeer: (code, reason) => {
        if (state.closed) return;
        state.cleanup();
        try { peer.close(sendableCloseCode(code), reason); } catch { /* already closed */ }
      },
      cleanup: () => {
        state.closed = true;
        clearInterval(state.drainTimer);
        clearTimeout(timer);
        if (this.#peers.get(id) === state) this.#peers.delete(id);
        for (const dispose of unsubscribe.splice(0)) dispose();
      },
    };
    this.#peers.set(id, state);
    unsubscribe.push(peer.onMessage((data) => {
      if (state.closed) return;
      if (wsMessageSize(data) > limits.maxWsMessageBytes) {
        this.#send({ type: 'ws.close', id, payload: { code: 1009, reason: 'Message too big' } });
        state.closePeer(1009, 'Message too big');
        return;
      }
      if (state.accepted) {
        state.forward(data);
        return;
      }
      queuedBytes += wsMessageSize(data);
      if (queuedBytes > limits.maxWsBufferedBytes) {
        this.#send({ type: 'ws.close', id, payload: { code: 1013, reason: 'Instance backpressure' } });
        state.settle(false);
        state.closePeer(1013, 'Instance backpressure');
        return;
      }
      state.queue.push(data);
    }));
    unsubscribe.push(peer.onClose((code, reason) => {
      if (state.closed) return;
      state.cleanup();
      state.settle(false);
      this.#send({ type: 'ws.close', id, payload: { code: wireCloseCode(code), reason: (reason ?? '').slice(0, 123) } });
    }));
    timer = setTimeout(() => {
      if (state.accepted || state.closed) return;
      this.#send({ type: 'ws.close', id, payload: { code: 1001, reason: 'Open timed out' } });
      state.cleanup();
      state.settle(false);
    }, this.#wsOpenTimeoutMs);
    timer.unref?.();
    this.#send({
      type: 'ws.open',
      id,
      payload: {
        url: info.url.href,
        headers,
        ...(info.principal ? { principal: info.principal } : {}),
        ...(info.remoteAddress ? { remoteAddress: info.remoteAddress } : {}),
      },
    });
    return opened;
  }

  #acknowledge(id: string, state: BridgedPeer, peer: WsConnection): void {
    const flush = (): boolean => {
      if (state.closed) return true;
      if (peer.bufferedAmount > this.#wsLowWater) return false;
      if (state.pendingAck > 0) {
        this.#send({ type: 'ws.drain', id, payload: { bytes: state.pendingAck } });
        state.pendingAck = 0;
      }
      return true;
    };
    if (state.drainTimer || flush()) return;
    // The client reads slowly: hold the acknowledgement until its socket drained.
    state.drainTimer = setInterval(() => {
      if (!flush()) return;
      clearInterval(state.drainTimer);
      state.drainTimer = undefined;
    }, DRAIN_POLL_MS);
    state.drainTimer.unref?.();
  }

  // ---- dispatch

  #dispatch(message: InstanceToGatewayMessage): void {
    switch (message.type) {
      case 'ready':
        if (!isBridgeProtocolCompatible(message.payload.version)) {
          this.#incompatible = true;
          return;
        }
        if (message.payload.routes) this.#setTable(message.payload.routes);
        return;
      case 'routes':
        this.#setTable(message.payload.table);
        return;
      case 'restart-request':
        return;
      case 'catalog': {
        this.#catalog = deepFreeze(message.payload.pluginPermissions.map((entry) => ({ ...entry, owners: [...entry.owners] })));
        for (const listener of [...this.#catalogListeners]) {
          try { listener(this.#catalog); } catch { /* observers never break the bridge */ }
        }
        return;
      }
      case 'audit':
        for (const listener of [...this.#auditListeners]) {
          try { listener(message.payload.entry); } catch { /* audit never breaks the bridge */ }
        }
        return;
      case 'http.response.head': {
        const exchange = this.#exchanges.get(message.id);
        if (!exchange || exchange.headReceived) return;
        exchange.headReceived = true;
        const id = message.id;
        const wanted = message.payload.body && !NULL_BODY_STATUSES.has(message.payload.status) && exchange.method !== 'HEAD';
        // Created synchronously: body chunks of the same IPC batch are dispatched right after.
        if (wanted) {
          exchange.body = new InboundBody({
            window: this.#limits.initialCreditBytes,
            grant: (bytes) => { if (this.#exchanges.get(id) === exchange) this.#send({ type: 'http.response.credit', id, payload: { bytes } }); },
            cancel: (reason) => { this.#cancelExchange(id, reason, 'Response cancelled'); },
          });
        }
        exchange.settleHead(message.payload);
        if (!message.payload.body) this.#finishExchange(id);
        // Body not wanted (HEAD / null-body status): stop the instance side.
        else if (!wanted) this.#cancelExchange(id, new Error('Response body not used'), 'Response body not used');
        return;
      }
      case 'http.response.body': {
        const exchange = this.#exchanges.get(message.id);
        if (!exchange?.body) return;
        if (!exchange.body.push(message.payload.chunk)) {
          this.#cancelExchange(message.id, new InstanceTransportError('instance-error', 'Response body exceeded the granted credit'), 'Credit exceeded');
        }
        return;
      }
      case 'http.response.end': {
        const exchange = this.#exchanges.get(message.id);
        if (!exchange) return;
        exchange.body?.end();
        this.#finishExchange(message.id);
        return;
      }
      case 'http.response.error': {
        const exchange = this.#exchanges.get(message.id);
        if (!exchange) return;
        const error = new InstanceTransportError('instance-error', message.payload.message);
        exchange.settleHead(error);
        exchange.body?.fail(error);
        this.#finishExchange(message.id);
        return;
      }
      case 'http.request.credit':
        this.#exchanges.get(message.id)?.gate.add(message.payload.bytes);
        return;
      case 'ws.accepted': {
        const state = this.#peers.get(message.id);
        if (!state || state.accepted || state.closed) return;
        state.accepted = true;
        for (const data of state.queue.splice(0)) state.forward(data);
        state.settle(true);
        return;
      }
      case 'ws.rejected': {
        const state = this.#peers.get(message.id);
        if (!state || state.accepted) return;
        state.cleanup();
        state.settle(false);
        return;
      }
      case 'ws.message': {
        const state = this.#peers.get(message.id);
        if (!state || state.closed) return;
        try {
          state.peer.send(message.payload.data);
        } catch { /* peer closing */ }
        state.pendingAck += Math.max(1, wsMessageSize(message.payload.data));
        this.#acknowledge(message.id, state, state.peer);
        return;
      }
      case 'ws.close': {
        const state = this.#peers.get(message.id);
        if (!state) return;
        state.settle(false);
        state.closePeer(message.payload.code, message.payload.reason);
        return;
      }
      case 'ws.drain': {
        const state = this.#peers.get(message.id);
        if (state) state.unacked = Math.max(0, state.unacked - message.payload.bytes);
        return;
      }
      default:
        return;
    }
  }

  #setTable(table: BridgeRouteTable): void {
    if (this.#tableReceived && table.revision <= this.#table.revision) return;
    this.#table = deepFreeze(table);
    this.#tableReceived = true;
    if (!this.#incompatible) this.#emitRoutes();
  }

  #emitRoutes(): void {
    const table = this.routes();
    for (const listener of [...this.#routeListeners]) {
      try { listener(table); } catch { /* observers never break the bridge */ }
    }
  }

  #send(message: GatewayToInstanceMessage): void {
    try { this.#port?.send(message); } catch { /* instance gone */ }
  }
}

/** Codes a peer reported locally (1005 / 1006) travel as is; anything else invalid becomes 1000. */
function wireCloseCode(code: number): number {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 1000;
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : fallback);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
