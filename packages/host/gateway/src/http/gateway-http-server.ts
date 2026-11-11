/**
 * The gateway's HTTP server (ADR 0054 §2 / §3): the project's only listener.
 *
 * Request flow:
 * 1. gateway-owned routes ({@link GatewayHttpServer.route} / `ws`) — health, later `/auth/*`,
 *    `iam.*`, terminal, onboarding, `gateway.*`;
 * 2. `{base}/…` — authenticated and authorized here, then forwarded with the principal;
 * 3. anything else (plugin webhooks, adapter reverse WebSockets, static pages) — forwarded as-is;
 *    those routes authenticate themselves.
 *
 * The instance being offline never takes gateway-owned routes down: forwarded requests get
 * `503 { code: 'instance_unavailable' }` with `Retry-After`.
 */
import {
  authorizeConsoleWebSocket,
  auditActor,
  createHttpRouter,
  extractBearerToken,
  jsonResponse,
  normalizePath,
  requestMeta,
  TokenRegistry,
  type ConsolePrincipal,
  type HttpHandler,
  type HttpHostAddress,
  type HttpHostOptions,
  type HttpRouteRegistration,
  type HttpRouter,
  type ResolvedHttpConfig,
  type RouteContext,
  type RouteMeta,
  type WsConnection,
  type WsHandle,
  type WsRouteOptions,
  type WsTransport,
  type WsUpgradeDecision,
  type WsUpgradeRequest,
} from '@zhin.js/host-http';
import { createNodeHttpListener, type NodeHttpListener } from '@zhin.js/host-http/node';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { InstanceTransport, InstanceWsOpenInfo } from './instance-transport.js';

const logger = getLogger('gateway');

export const DEFAULT_GATEWAY_RETRY_AFTER_SECONDS = 5;
/** Default cap on a forwarded request body (uploads go through the instance). */
export const DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;
/** Client frames kept while the instance side of a forwarded socket is being opened. */
const WS_PENDING_FRAME_LIMIT = 256;
const WS_PENDING_BYTE_LIMIT = 4 * 1024 * 1024;

/** Where the server finds the instance; both are read per request. */
export interface GatewayInstanceSource {
  /** Current transport; undefined while no instance process exists. */
  transport(): InstanceTransport | undefined;
  /** Supervisor state reported in 503 bodies and `/pub/health` (e.g. `starting`, `crashed`). */
  state(): string;
}

export interface GatewayHttpServerOptions {
  /** Resolved `http.*` config: the primary listener plus `listeners` (extra ports, TLS). */
  readonly http?: ResolvedHttpConfig;
  readonly instance: GatewayInstanceSource;
  /**
   * Console authentication. The access provider (users, sessions, API tokens) is installed on it
   * by the IAM module; defaults to a registry over `http.token`.
   */
  readonly tokenRegistry?: TokenRegistry;
  readonly retryAfterSeconds?: number;
  readonly maxRequestBodyBytes?: number;
}

const HOP_BY_HOP_HEADERS = Object.freeze([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** One router, many listeners: every listener serves the same surface. */
export class GatewayHttpServer {
  readonly tokenRegistry: TokenRegistry;
  readonly apiBase: string;
  readonly #router: HttpRouter;
  readonly #listeners: readonly NodeHttpListener[];
  readonly #instance: GatewayInstanceSource;
  readonly #retryAfter: string;
  readonly #maxBody: number;
  #closed = false;
  #closeResult: Promise<void> | undefined;

  constructor(options: GatewayHttpServerOptions) {
    const { listeners: extra = [], ...primary } = options.http ?? {};
    const listenerOptions: readonly HttpHostOptions[] = [primary, ...extra];
    this.#instance = options.instance;
    this.#retryAfter = String(Math.max(1, Math.round(options.retryAfterSeconds ?? DEFAULT_GATEWAY_RETRY_AFTER_SECONDS)));
    this.#maxBody = options.maxRequestBodyBytes ?? DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES;
    this.tokenRegistry = options.tokenRegistry ?? new TokenRegistry({ primaryToken: primary.token });
    this.apiBase = normalizePath(primary.apiBase ?? '/api');
    this.#router = createHttpRouter({
      corsOrigins: primary.corsOrigins,
      apiBase: this.apiBase,
      authExemptPaths: primary.authExemptPaths,
      tokenRegistry: this.tokenRegistry,
      secure: primary.tls !== undefined,
      address: () => this.address,
      builtinRoutes: false,
    });
    this.#router.route('GET', '/pub/health', () => this.#health(), { summary: 'Gateway health probe', tags: ['pub'] });
    // Lowest precedence: every path no gateway route claims goes to the instance.
    this.#router.route('ALL', '/*', (request, context) => this.#forward(request, context));
    this.#listeners = listenerOptions.map((entry) => createNodeHttpListener({
      host: entry.host,
      port: entry.port,
      tls: entry.tls,
      handle: (request, info) => this.#router.handle(request, info),
      upgrade: (request) => this.#upgrade(request),
      onListening: (address) => {
        logger.info(formatCompact({ op: 'gateway_listening', origin: address.origin, base: this.apiBase }));
      },
    }));
  }

  /** Registers a gateway-owned route; it takes precedence over the instance's routes. */
  route(method: string, path: string, handler: HttpHandler, meta?: RouteMeta): HttpRouteRegistration {
    return this.#router.route(method, path, handler, meta);
  }

  /** Registers a gateway-owned WebSocket route. */
  ws(path: string, options?: WsRouteOptions): WsHandle {
    return this.#router.ws(path, options);
  }

  /** Handles one request without a socket (tests, local socket bridge). */
  handle(request: Request, info: { readonly remoteAddress?: string } = {}): Promise<Response> {
    return this.#router.handle(request, info);
  }

  /** Primary listener address. */
  get address(): HttpHostAddress | undefined {
    return this.#listeners[0]?.address;
  }

  /** Addresses of every bound listener, primary first. */
  get addresses(): readonly HttpHostAddress[] {
    return this.#listeners.flatMap((listener) => listener.address ? [listener.address] : []);
  }

  async listen(): Promise<HttpHostAddress> {
    if (this.#closed) throw new Error('Gateway HTTP server is closed');
    try {
      for (const listener of this.#listeners) await listener.listen();
    } catch (error) {
      await Promise.allSettled([...this.#listeners].reverse().map((listener) => listener.close()));
      throw error;
    }
    return this.#listeners[0]!.address!;
  }

  close(): Promise<void> {
    this.#closeResult ??= (async () => {
      this.#closed = true;
      this.#router.close();
      const results = await Promise.allSettled([...this.#listeners].reverse().map((listener) => listener.close()));
      const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'multiple gateway listeners failed to close');
    })();
    return this.#closeResult;
  }

  #readyTransport(): InstanceTransport | undefined {
    const transport = this.#instance.transport();
    return transport?.ready ? transport : undefined;
  }

  #health(): Response {
    return jsonResponse(200, {
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      instance: { state: this.#instance.state(), ready: this.#readyTransport() !== undefined },
    });
  }

  #unavailable(): Response {
    return jsonResponse(503, {
      success: false,
      code: 'instance_unavailable',
      requestOutcome: 'not-dispatched',
      state: this.#instance.state(),
      error: 'The Zhin instance is not running',
    }, { 'retry-after': this.#retryAfter, 'cache-control': 'no-store' });
  }

  async #forward(request: Request, context: RouteContext): Promise<Response> {
    const transport = this.#readyTransport();
    if (!transport) return this.#unavailable();
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > this.#maxBody) return tooLarge();
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    const body = request.body ? limitBody(request.body, this.#maxBody) : null;
    const forwarded = new Request(context.url, {
      method: request.method,
      headers,
      signal: request.signal,
      ...(body ? { body, duplex: 'half' } : {}),
    } as RequestInit);
    let response: Response;
    try {
      response = await transport.fetch(forwarded, {
        ...(context.principal ? { principal: context.principal } : {}),
        ...(context.remoteAddress ? { remoteAddress: context.remoteAddress } : {}),
      });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (error instanceof BodyLimitError) return tooLarge();
      if (!transport.ready) return this.#unavailable();
      logger.warn(formatCompact({
        op: 'gateway_forward_failed',
        path: context.url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return jsonResponse(502, { success: false, code: 'instance_error', error: 'The instance failed to answer' });
    }
    return stripHopByHop(response);
  }

  async #upgrade(request: WsUpgradeRequest): Promise<WsUpgradeDecision> {
    const own = await this.#router.upgrade(request);
    if (own.accepted || own.status !== 404 || this.#closed) return own;
    const transport = this.#readyTransport();
    if (!transport) return Object.freeze({ accepted: false, status: 503, headers: { 'Retry-After': this.#retryAfter } });
    const pathname = normalizePath(request.url.pathname);
    const routes = transport.routes().ws.filter((route) => normalizePath(route.path) === pathname);
    if (routes.length === 0) return Object.freeze({ accepted: false, status: 404 });
    let principal: ConsolePrincipal | undefined;
    if (!routes.every((route) => route.auth === 'protocol')) {
      principal = await this.#authenticateUpgrade(request, pathname).catch(() => undefined);
      if (!principal) return Object.freeze({ accepted: false, status: 401 });
    }
    const info: InstanceWsOpenInfo = Object.freeze({
      url: request.url,
      headers: request.headers,
      ...(principal ? { principal } : {}),
      ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}),
    });
    return Object.freeze({
      accepted: true as const,
      reject: () => undefined,
      accept: (socket: WsTransport) => {
        const peer = bufferedConnection(info, socket);
        transport.openWebSocket(info, peer).then((opened) => {
          if (!opened) peer.close(1013, 'Instance unavailable');
        }, (error: unknown) => {
          logger.warn(formatCompact({
            op: 'gateway_ws_forward_failed',
            path: pathname,
            error: error instanceof Error ? error.message : String(error),
          }));
          peer.close(1011, 'Instance unavailable');
        });
      },
    });
  }

  async #authenticateUpgrade(request: WsUpgradeRequest, pathname: string): Promise<ConsolePrincipal | undefined> {
    const token = extractBearerToken(request.headers.get('authorization') ?? undefined, request.url.searchParams.get('token'));
    const principal = await this.tokenRegistry.authenticate(token, requestMeta(request, request.remoteAddress));
    if (!principal) return undefined;
    if (!authorizeConsoleWebSocket(principal, pathname)) {
      const provider = this.tokenRegistry.accessProvider;
      try {
        provider?.audit?.({
          actor: auditActor(principal),
          action: `ws:${pathname}`,
          outcome: 'denied',
          ...(request.remoteAddress ? { ip: request.remoteAddress } : {}),
        });
      } catch { /* audit never breaks a request */ }
      return undefined;
    }
    return principal;
  }
}

class BodyLimitError extends Error {}

function tooLarge(): Response {
  return jsonResponse(413, { success: false, code: 'payload_too_large', requestOutcome: 'not-dispatched', error: 'Request body too large' });
}

function limitBody(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) controller.error(new BodyLimitError('Request body too large'));
      else controller.enqueue(chunk);
    },
  }));
}

function stripHopByHop(response: Response): Response {
  if (!HOP_BY_HOP_HEADERS.some((name) => response.headers.has(name))) return response;
  const headers = new Headers(response.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * A {@link WsConnection} over the client socket that keeps client frames until the instance side
 * subscribes (opening it is asynchronous); too many early frames close the socket (1009).
 */
function bufferedConnection(info: InstanceWsOpenInfo, socket: WsTransport): WsConnection {
  const listeners = new Set<(data: string | Uint8Array) => void>();
  let pending: Array<string | Uint8Array> | undefined = [];
  let pendingBytes = 0;
  socket.onMessage((data) => {
    if (pending) {
      pending.push(data);
      pendingBytes += typeof data === 'string' ? data.length : data.byteLength;
      if (pending.length > WS_PENDING_FRAME_LIMIT || pendingBytes > WS_PENDING_BYTE_LIMIT) {
        pending = [];
        socket.close(1009, 'Too many frames before the instance accepted the socket');
      }
      return;
    }
    for (const listener of [...listeners]) {
      try { listener(data); } catch { /* isolate listener failures */ }
    }
  });
  socket.onClose(() => {
    pending = undefined;
    listeners.clear();
  });
  return Object.freeze({
    url: info.url,
    headers: info.headers,
    ...(info.principal ? { principal: info.principal } : {}),
    ...(info.remoteAddress ? { remoteAddress: info.remoteAddress } : {}),
    send: (data: string | Uint8Array) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
    onMessage(listener: (data: string | Uint8Array) => void): () => void {
      listeners.add(listener);
      if (pending) {
        const queued = pending;
        pending = undefined;
        queueMicrotask(() => {
          for (const data of queued) {
            for (const current of [...listeners]) {
              try { current(data); } catch { /* isolate listener failures */ }
            }
          }
        });
      }
      return () => { listeners.delete(listener); };
    },
    onClose: (listener: (code: number, reason: string) => void) => socket.onClose(listener),
    get bufferedAmount() { return socket.bufferedAmount; },
  });
}
