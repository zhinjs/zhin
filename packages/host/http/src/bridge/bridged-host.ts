/**
 * Instance side of the HTTP bridge (ADR 0054 §2 / §3): `BridgedHttpHost` implements the same
 * {@link HttpHost} surface as the in-process Node server, but serves requests that the gateway
 * forwards over the control channel. Routing, CORS, generation admission and Console
 * authorization are the shared router's (`createHttpRouter`), running in `forwarded`
 * authentication mode: the gateway authenticated the caller and the principal travels with the
 * request; the router still authorizes it against the Console permission map.
 *
 * Nothing here imports `node:http` or `ws`.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
} from '@zhin.js/plugin-runtime';
import {
  createHttpRouter,
  type HttpHost,
  type HttpRouter,
  type HttpRouterOptions,
  type WsTransport,
} from '../http-host.js';
import type { ConsoleUserPrincipal } from '../access-control.js';
import type { HttpHostAddress } from '../host-options.js';
import { httpHostAddressProvider, type AddressAwareHttpHost } from '../addresses.js';
import type { RouteMeta } from '../openapi.js';
import { CreditGate, InboundBody, ownBytes, pumpBody } from './flow.js';
import {
  DEFAULT_BRIDGE_LIMITS,
  fromBridgeHeaders,
  parseBridgePrincipal,
  toBridgeHeaders,
  wsMessageSize,
  type BridgeLimits,
  type BridgeRouteTable,
  type GatewayToInstanceMessage,
  type HttpRequestMessage,
  type InstanceToGatewayMessage,
  type WsOpenMessage,
} from './protocol.js';

const logger = getLogger('http');
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
/** How often the owner-exists flag is re-read for `auth.state` (also re-read after each exchange). */
const AUTH_STATE_POLL_MS = 1_000;

/** What the bridged Host needs from the control channel (see `openInstanceControlChannel`). */
export interface BridgeChannel {
  send(message: InstanceToGatewayMessage): void;
  onMessage(listener: (message: GatewayToInstanceMessage) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  /** Keeps the process alive while the Host listens (see `InstanceControlChannel.hold`). */
  hold?(): () => void;
}

export interface BridgedHttpHostOptions extends Omit<HttpRouterOptions, 'address' | 'authentication' | 'secure'> {
  readonly channel: BridgeChannel;
  readonly limits?: Partial<BridgeLimits>;
}

/** @public Instance HTTP Host carried by the gateway bridge. */
export interface BridgedHttpHost extends HttpHost, GenerationAdmissionBindable<HttpHost>, AddressAwareHttpHost {
  /**
   * Opens the bridge: announces the route table and starts serving forwarded requests.
   * Resolves with the gateway's primary address once the gateway announced it (else undefined).
   */
  listen(): Promise<HttpHostAddress | undefined>;
  /** Ends every exchange and socket, withdraws the route table and drops all routes. */
  close(): Promise<void>;
  /** Route table as the gateway sees it. */
  routeTable(): BridgeRouteTable;
  /** Announces the table again, tagged with `generation` (call on generation commit). */
  publishRoutes(generation?: number): void;
  /** Open HTTP exchanges plus WebSocket connections. */
  readonly activeStreams: number;
}

interface Exchange {
  readonly abort: AbortController;
  readonly gate: CreditGate;
  body?: InboundBody;
}

interface BridgedSocket {
  readonly messageListeners: Set<(data: string | Uint8Array) => void>;
  readonly closeListeners: Set<(code: number, reason: string) => void>;
  buffered: number;
  closed: boolean;
  /** Ends the socket locally and fires close listeners; `notify` also tells the gateway. */
  finish(code: number, reason: string, notify: boolean): void;
}

export function createBridgedHttpHost(options: BridgedHttpHostOptions): BridgedHttpHost {
  const limits: BridgeLimits = Object.freeze({ ...DEFAULT_BRIDGE_LIMITS, ...options.limits });
  const { channel } = options;
  let addresses: readonly HttpHostAddress[] = Object.freeze([]);
  const router: HttpRouter = createHttpRouter({
    ...options,
    authentication: 'forwarded',
    address: () => addresses[0],
    secure: false,
  });
  const exchanges = new Map<string, Exchange>();
  const sockets = new Map<string, BridgedSocket>();
  let listening = false;
  let closed = false;
  let revision = 0;
  let generation: number | undefined;
  let lastSent: string | undefined;
  let publishScheduled = false;
  let closeResult: Promise<void> | undefined;
  const disposers: Array<() => void> = [];
  let authState: boolean | undefined;

  const send = (message: InstanceToGatewayMessage): void => {
    try { channel.send(message); } catch { /* channel gone */ }
  };

  // ---- delegated authentication (interim until B1.4, see protocol `auth.*`)

  function publishAuthState(): void {
    if (!listening || closed) return;
    const initialized = router.tokenRegistry.initialized();
    if (initialized === authState) return;
    authState = initialized;
    send({ type: 'auth.state', payload: { initialized } });
  }

  async function handleAuthenticate(id: string, token: string, ip: string | undefined, userAgent: string | undefined): Promise<void> {
    const provider = router.tokenRegistry.accessProvider;
    let principal: ConsoleUserPrincipal | null = null;
    if (provider && token && listening && !closed) {
      try {
        principal = await provider.authenticate(token, {
          ...(ip ? { ip } : {}),
          ...(userAgent ? { userAgent } : {}),
        });
      } catch {
        principal = null;
      }
    }
    publishAuthState();
    send({ type: 'auth.result', id, payload: { principal } });
  }

  function routeTable(): BridgeRouteTable {
    if (closed) {
      return Object.freeze({ revision, ...(generation !== undefined ? { generation } : {}), apiBase: router.apiBase, http: Object.freeze([]), ws: Object.freeze([]) });
    }
    return Object.freeze({
      revision,
      ...(generation !== undefined ? { generation } : {}),
      apiBase: router.apiBase,
      http: Object.freeze(router.listRoutes().map((route) => {
        const meta = cloneableMeta(route.meta);
        return Object.freeze({ method: route.method, pattern: route.pattern, ...(meta ? { meta } : {}) });
      })),
      ws: router.listWsRoutes(),
    });
  }

  function sendRoutes(force: boolean): void {
    if (!listening) return;
    const table = routeTable();
    const fingerprint = JSON.stringify([table.generation, table.http, table.ws]);
    if (!force && fingerprint === lastSent) return;
    lastSent = fingerprint;
    revision += 1;
    send({ type: 'routes', payload: { table: { ...table, revision } } });
  }

  // Registration bursts (a generation registering dozens of routes) coalesce into one table.
  const schedulePublish = (): void => {
    if (!listening || publishScheduled) return;
    publishScheduled = true;
    queueMicrotask(() => {
      publishScheduled = false;
      sendRoutes(false);
    });
  };

  // ---- HTTP

  async function handleRequest(message: HttpRequestMessage): Promise<void> {
    const { id, payload } = message;
    if (exchanges.has(id) || sockets.has(id)) return;
    if (!listening || closed || exchanges.size + sockets.size >= limits.maxStreams) {
      send({ type: 'http.response.head', id, payload: { status: 503, headers: [], body: false } });
      send({ type: 'http.response.end', id, payload: {} });
      return;
    }
    const exchange: Exchange = { abort: new AbortController(), gate: new CreditGate(limits.initialCreditBytes) };
    exchanges.set(id, exchange);
    const method = payload.method.toUpperCase();
    if (payload.body && !BODYLESS_METHODS.has(method)) {
      exchange.body = new InboundBody({
        window: limits.initialCreditBytes,
        grant: (bytes) => { if (exchanges.get(id) === exchange) send({ type: 'http.request.credit', id, payload: { bytes } }); },
        // The gateway stops sending once the response ends; nothing to tell it now.
        cancel: () => undefined,
      });
    }
    try {
      let request: Request;
      try {
        request = new Request(payload.url, {
          method,
          headers: fromBridgeHeaders(payload.headers),
          signal: exchange.abort.signal,
          ...(exchange.body ? { body: exchange.body.stream, duplex: 'half' } : {}),
        } as RequestInit);
      } catch {
        sendHead(id, new Response(null, { status: 400 }));
        send({ type: 'http.response.end', id, payload: {} });
        return;
      }
      const principal = payload.principal === undefined ? undefined : parseBridgePrincipal(payload.principal);
      const response = await router.handle(request, {
        ...(payload.remoteAddress ? { remoteAddress: payload.remoteAddress } : {}),
        ...(principal ? { principal } : {}),
      });
      if (exchange.abort.signal.aborted) {
        await response.body?.cancel(exchange.abort.signal.reason).catch(() => undefined);
        return;
      }
      sendHead(id, response);
      if (response.body) {
        await pumpBody(response.body, {
          gate: exchange.gate,
          maxChunkBytes: limits.maxChunkBytes,
          signal: exchange.abort.signal,
          send: (chunk) => send({ type: 'http.response.body', id, payload: { chunk } }),
        });
      }
      if (!exchange.abort.signal.aborted) send({ type: 'http.response.end', id, payload: {} });
    } catch (error) {
      if (!exchange.abort.signal.aborted) {
        logger.debug(formatCompact({ op: 'bridge_response_failed', error: errorText(error) }));
        send({ type: 'http.response.error', id, payload: { message: errorText(error).slice(0, 512) } });
      }
    } finally {
      if (exchanges.get(id) === exchange) exchanges.delete(id);
      exchange.gate.close();
      exchange.body?.fail(new Error('Exchange finished'));
      // Setup (first owner) happens over HTTP: report it before the next request.
      publishAuthState();
    }
  }

  function sendHead(id: string, response: Response): void {
    send({
      type: 'http.response.head',
      id,
      payload: {
        status: response.status,
        ...(response.statusText ? { statusText: response.statusText.slice(0, 256) } : {}),
        headers: toBridgeHeaders(response.headers),
        body: response.body !== null,
      },
    });
  }

  function abortExchange(id: string, reason: string, notify: boolean): void {
    const exchange = exchanges.get(id);
    if (!exchange) return;
    exchanges.delete(id);
    const error = new Error(reason);
    exchange.abort.abort(error);
    exchange.gate.close(error);
    exchange.body?.fail(error);
    if (notify) send({ type: 'http.response.error', id, payload: { message: reason } });
  }

  // ---- WebSocket

  async function handleWsOpen(message: WsOpenMessage): Promise<void> {
    const { id, payload } = message;
    if (exchanges.has(id) || sockets.has(id)) return;
    if (!listening || closed || exchanges.size + sockets.size >= limits.maxStreams) {
      send({ type: 'ws.rejected', id, payload: { status: 503 } });
      return;
    }
    let url: URL;
    try {
      url = new URL(payload.url);
    } catch {
      send({ type: 'ws.rejected', id, payload: { status: 404 } });
      return;
    }
    const principal = payload.principal === undefined ? undefined : parseBridgePrincipal(payload.principal);
    // Reserve the id while the upgrade is decided, so a racing ws.close is not lost.
    const socket = createSocket(id);
    sockets.set(id, socket);
    const decision = await router.upgrade({
      url,
      headers: fromBridgeHeaders(payload.headers),
      ...(payload.remoteAddress ? { remoteAddress: payload.remoteAddress } : {}),
      ...(principal ? { principal } : {}),
    }).catch(() => ({ accepted: false as const, status: 404 as const }));
    if (!decision.accepted) {
      sockets.delete(id);
      if (!socket.closed) send({ type: 'ws.rejected', id, payload: { status: decision.status } });
      return;
    }
    if (socket.closed || closed) {
      sockets.delete(id);
      decision.reject();
      if (!socket.closed) send({ type: 'ws.rejected', id, payload: { status: 503 } });
      return;
    }
    send({ type: 'ws.accepted', id, payload: {} });
    const transport: WsTransport = {
      send(data) {
        if (socket.closed) return;
        const size = wsMessageSize(data);
        if (size > limits.maxWsMessageBytes) {
          socket.finish(1009, 'Message too big', true);
          return;
        }
        if (socket.buffered + size > limits.maxWsBufferedBytes) {
          socket.finish(1013, 'Bridge backpressure', true);
          return;
        }
        socket.buffered += size;
        send({ type: 'ws.message', id, payload: { data: typeof data === 'string' ? data : ownBytes(data) } });
      },
      close(code = 1000, reason = '') {
        socket.finish(code, reason, true);
      },
      onMessage(listener) {
        socket.messageListeners.add(listener);
        return () => { socket.messageListeners.delete(listener); };
      },
      onClose(listener) {
        socket.closeListeners.add(listener);
        return () => { socket.closeListeners.delete(listener); };
      },
      get bufferedAmount() { return socket.buffered; },
    };
    decision.accept(transport);
  }

  function createSocket(id: string): BridgedSocket {
    const socket: BridgedSocket = {
      messageListeners: new Set(),
      closeListeners: new Set(),
      buffered: 0,
      closed: false,
      finish(code, reason, notify) {
        if (socket.closed) return;
        socket.closed = true;
        if (sockets.get(id) === socket) sockets.delete(id);
        if (notify) send({ type: 'ws.close', id, payload: { code: sendableCloseCode(code), reason: reason.slice(0, 123) } });
        for (const listener of [...socket.closeListeners]) {
          try { listener(code, reason); } catch { /* listener failure stays local */ }
        }
        socket.closeListeners.clear();
        socket.messageListeners.clear();
      },
    };
    return socket;
  }

  function deliverWsMessage(id: string, data: string | Uint8Array): void {
    const socket = sockets.get(id);
    if (!socket || socket.closed) return;
    for (const listener of [...socket.messageListeners]) {
      try {
        listener(data);
      } catch (error) {
        logger.warn(formatCompact({ op: 'ws_message_listener_failed', error: errorText(error) }));
      }
    }
    send({ type: 'ws.drain', id, payload: { bytes: Math.max(1, wsMessageSize(data)) } });
  }

  // ---- channel

  const onMessage = (message: GatewayToInstanceMessage): void => {
    switch (message.type) {
      case 'host.addresses':
        addresses = Object.freeze(message.payload.addresses.map((address) => Object.freeze({ ...address })));
        return;
      case 'http.request':
        void handleRequest(message);
        return;
      case 'auth.authenticate':
        void handleAuthenticate(message.id, message.payload.token, message.payload.ip, message.payload.userAgent);
        return;
      case 'auth.audit':
        try { router.tokenRegistry.accessProvider?.audit?.(message.payload.entry); } catch { /* audit never breaks the bridge */ }
        return;
      case 'http.request.body': {
        const exchange = exchanges.get(message.id);
        if (exchange?.body && !exchange.body.push(message.payload.chunk)) {
          abortExchange(message.id, 'Request body exceeded the granted credit', true);
        }
        return;
      }
      case 'http.request.end':
        exchanges.get(message.id)?.body?.end();
        return;
      case 'http.request.abort':
        abortExchange(message.id, message.payload.message, false);
        return;
      case 'http.response.credit':
        exchanges.get(message.id)?.gate.add(message.payload.bytes);
        return;
      case 'ws.open':
        void handleWsOpen(message);
        return;
      case 'ws.message':
        deliverWsMessage(message.id, message.payload.data);
        return;
      case 'ws.close':
        sockets.get(message.id)?.finish(message.payload.code, message.payload.reason, false);
        return;
      case 'ws.drain': {
        const socket = sockets.get(message.id);
        if (socket) socket.buffered = Math.max(0, socket.buffered - message.payload.bytes);
        return;
      }
      default:
        return;
    }
  };

  const onDisconnect = (): void => {
    for (const id of [...exchanges.keys()]) abortExchange(id, 'Gateway disconnected', false);
    for (const socket of [...sockets.values()]) socket.finish(1006, 'Gateway disconnected', false);
  };

  const host: BridgedHttpHost = {
    [generationAdmissionBinder]: (admission) => router[generationAdmissionBinder](admission),
    [httpHostAddressProvider]: () => addresses,
    ws: (pathname, wsOptions) => router.ws(pathname, wsOptions),
    route: (method, path, handler, meta) => router.route(method, path, handler, meta),
    listRoutes: () => router.listRoutes(),
    get address() { return addresses[0]; },
    get tokenRegistry() { return router.tokenRegistry; },
    get activeStreams() { return exchanges.size + sockets.size; },
    routeTable,
    publishRoutes(next) {
      if (next !== undefined) generation = next;
      sendRoutes(true);
    },
    async listen() {
      if (closed) throw new Error('HTTP Host is closed');
      if (!listening) {
        listening = true;
        disposers.push(channel.onMessage(onMessage), channel.onDisconnect(onDisconnect), router.onRoutesChanged(schedulePublish));
        // Like a listening server, a listening bridge keeps the instance alive until close().
        if (channel.hold) disposers.push(channel.hold());
        sendRoutes(true);
        publishAuthState();
        const authPoll = setInterval(publishAuthState, AUTH_STATE_POLL_MS);
        authPoll.unref?.();
        disposers.push(() => clearInterval(authPoll));
        logger.debug(formatCompact({ op: 'bridge_listening', routes: router.routeCount, ws: router.wsPaths.length }));
      }
      return addresses[0];
    },
    close() {
      closeResult ??= (async () => {
        const wasListening = listening;
        closed = true;
        for (const id of [...exchanges.keys()]) abortExchange(id, 'Instance stopping', wasListening);
        for (const socket of [...sockets.values()]) socket.finish(1001, 'Instance stopping', wasListening);
        if (wasListening) sendRoutes(true);
        listening = false;
        router.close();
        for (const dispose of disposers.splice(0)) dispose();
      })();
      return closeResult;
    },
  };
  return host;
}

/** Route meta that survives structured clone (JSON data only); otherwise dropped. */
function cloneableMeta(meta: RouteMeta | undefined): RouteMeta | undefined {
  if (!meta) return undefined;
  try {
    return JSON.parse(JSON.stringify(meta)) as RouteMeta;
  } catch {
    return undefined;
  }
}

/** Close codes a peer may put on the wire; reserved ones (1005, 1006, 1015) become 1000. */
export function sendableCloseCode(code: number): number {
  if (!Number.isInteger(code)) return 1000;
  if ((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)) return code;
  return 1000;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
