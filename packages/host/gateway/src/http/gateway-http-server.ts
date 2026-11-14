/**
 * The gateway's HTTP server (ADR 0054 §2 / §3): the project's only listener.
 *
 * Request flow:
 * 1. gateway-owned routes ({@link GatewayHttpServer.route} / `ws`) — health, `/auth/*`,
 *    terminal, the merged Console event stream, package progress; gateway-owned Console RPC
 *    (`gateway.*`, `iam.*`, `onboarding.update`) inside `POST {base}/console/request`;
 * 2. `{base}/…` — authenticated and authorized here, then forwarded with the principal;
 * 3. anything else (plugin webhooks, adapter reverse WebSockets, static pages) — forwarded as-is;
 *    those routes authenticate themselves.
 *
 * The instance being offline never takes gateway-owned routes down: forwarded requests get
 * `503 { code: 'instance_unavailable', state }` with `Retry-After`; an instance that does not
 * answer in time gives `504 { code: 'instance_timeout' }`, any other bridge failure
 * `502 { code: 'instance_error' }` (mapped from {@link InstanceTransportError}).
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
  webSocketDenialReason,
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
import {
  InstanceTransportError,
  type InstanceTransport,
  type InstanceWsOpenInfo,
} from '@zhin.js/host-http/bridge';
import { createNodeHttpListener, type NodeHttpListener } from '@zhin.js/host-http/node';
import {
  CONSOLE_CAPABILITIES_PATH,
  CONSOLE_FEATURES,
  GATEWAY_RPC,
  createConsoleCapabilities,
  mergeConsoleCapabilities,
  parseConsoleCapabilities,
  type ConsoleCapabilities,
  type GatewayHealth,
  type GatewayInstanceErrorCode,
  type GatewayInstanceErrorReply,
  type GatewayInstanceState,
} from '@zhin.js/console-protocol';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { databaseBusyResponse, isDatabaseBusyError } from '../database/project-database.js';
import { GATEWAY_RPC_PREFIX, type GatewayConsoleRpc, type GatewayRpcHandler } from './console-rpc.js';
import { LOCAL_OWNER_PRINCIPAL } from './local-principal.js';

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
  /**
   * Gateway-owned Console RPC (`gateway.*`) answered on `POST {base}/console/request`; every other
   * RPC type on that route is forwarded to the instance unchanged.
   */
  readonly consoleRpc?: GatewayConsoleRpc;
  /** Reported on `/pub/health` as `project.id` (`projectIdentity(projectRoot)`). */
  readonly projectId?: string;
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
  /**
   * The same surface for `gateway.http.request` without a credential: a `forwarded` router that
   * takes {@link LOCAL_OWNER_PRINCIPAL} as authenticated and still authorizes every route against
   * the Console permission map, like the HTTP router does.
   */
  readonly #localRouter: HttpRouter;
  readonly #listeners: readonly NodeHttpListener[];
  readonly #instance: GatewayInstanceSource;
  readonly #retryAfter: string;
  readonly #maxBody: number;
  readonly #consoleRpc: GatewayConsoleRpc | undefined;
  /** The instance connection (and route table) that has no capability route: asked once. */
  #capabilitiesMissing: { readonly transport: InstanceTransport; readonly revision: number | undefined } | undefined;
  readonly #projectId: string | undefined;
  readonly #rpcHandlers = new Set<GatewayRpcHandler>();
  #closed = false;
  #closeResult: Promise<void> | undefined;

  constructor(options: GatewayHttpServerOptions) {
    const { listeners: extra = [], ...primary } = options.http ?? {};
    const listenerOptions: readonly HttpHostOptions[] = [primary, ...extra];
    this.#instance = options.instance;
    this.#retryAfter = String(Math.max(1, Math.round(options.retryAfterSeconds ?? DEFAULT_GATEWAY_RETRY_AFTER_SECONDS)));
    this.#maxBody = options.maxRequestBodyBytes ?? DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES;
    this.#consoleRpc = options.consoleRpc;
    this.#projectId = options.projectId;
    this.tokenRegistry = options.tokenRegistry ?? new TokenRegistry({ primaryToken: primary.token });
    this.apiBase = normalizePath(primary.apiBase ?? '/api');
    const routerOptions = {
      corsOrigins: primary.corsOrigins,
      apiBase: this.apiBase,
      authExemptPaths: primary.authExemptPaths,
      tokenRegistry: this.tokenRegistry,
      secure: primary.tls !== undefined,
      address: () => this.address,
      builtinRoutes: false,
    } as const;
    this.#router = createHttpRouter(routerOptions);
    this.#localRouter = createHttpRouter({ ...routerOptions, authentication: 'forwarded' });
    for (const router of [this.#router, this.#localRouter]) {
      router.route('GET', '/pub/health', () => this.#health(), { summary: 'Gateway health probe', tags: ['pub'] });
      router.route('POST', `${this.apiBase}/console/request`, (request, context) => this.#consoleRequest(request, context), {
        summary: 'Console RPC (gateway-owned types answered by the gateway, the rest forwarded)',
        tags: ['console'],
      });
      router.route('GET', `${this.apiBase}${CONSOLE_CAPABILITIES_PATH}`, (request, context) => this.#capabilities(request, context), {
        summary: 'Console capabilities (gateway-owned RPC types merged with the instance\'s)',
        tags: ['console'],
      });
      // Lowest precedence: every path no gateway route claims goes to the instance.
      router.route('ALL', '/*', (request, context) => this.#forward(request, context));
    }
    this.#listeners = listenerOptions.map((entry) => createNodeHttpListener({
      host: entry.host,
      port: entry.port,
      tls: entry.tls,
      trustProxy: entry.trustProxy,
      handle: (request, info) => this.#router.handle(request, info),
      upgrade: (request) => this.#upgrade(request),
      onListening: (address) => {
        logger.info(formatCompact({ op: 'gateway_listening', origin: address.origin, base: this.apiBase }));
      },
    }));
  }

  /** Registers a gateway-owned route; it takes precedence over the instance's routes. */
  route(method: string, path: string, handler: HttpHandler, meta?: RouteMeta): HttpRouteRegistration {
    const wrapped = withDatabaseBusy(handler);
    const unregister = [this.#router.route(method, path, wrapped, meta), this.#localRouter.route(method, path, wrapped, meta)];
    return () => { for (const release of unregister) release(); };
  }

  /** Registers a gateway-owned WebSocket route. */
  ws(path: string, options?: WsRouteOptions): WsHandle {
    return this.#router.ws(path, options);
  }

  /**
   * Answers further RPC types on `POST {base}/console/request` (e.g. `iam.*`); the handler checks
   * the per-RPC permission itself. Returns an unregister function.
   */
  useConsoleRpc(handler: GatewayRpcHandler): () => void {
    this.#rpcHandlers.add(handler);
    return () => { this.#rpcHandlers.delete(handler); };
  }

  /** Whether an instance is connected and serving its route table. */
  get instanceReady(): boolean {
    return this.#readyTransport() !== undefined;
  }

  /**
   * Forwards one request to the instance (the router already authenticated and authorized it):
   * the instance's response, or the documented 502 / 503 / 504 / 413 gateway responses.
   */
  forward(request: Request, context: RouteContext): Promise<Response> {
    return this.#forward(request, context);
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
      this.#localRouter.close();
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
    const body: GatewayHealth = {
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      instance: { state: this.#instance.state() as GatewayInstanceState, ready: this.#readyTransport() !== undefined },
      ...(this.#projectId ? { project: { id: this.#projectId } } : {}),
    };
    // Polled by the Console's instance banner: never cached.
    return jsonResponse(200, body, { 'cache-control': 'no-store' });
  }

  #unavailable(): Response {
    return this.#instanceError(503, 'instance_unavailable', 'not-dispatched', 'The Zhin instance is not running', true);
  }

  /** One body shape for every forward failure (`GatewayInstanceErrorReply`, ADR 0054 §3). */
  #instanceError(status: 502 | 503 | 504, code: GatewayInstanceErrorCode, requestOutcome: GatewayInstanceErrorReply['requestOutcome'], error: string, retry: boolean): Response {
    const body: GatewayInstanceErrorReply = { success: false, code, requestOutcome, state: this.#instance.state() as GatewayInstanceState, error };
    return jsonResponse(status, body, { ...(retry ? { 'retry-after': this.#retryAfter } : {}), 'cache-control': 'no-store' });
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
      if (error instanceof BodyLimitError || (error instanceof Error && error.cause instanceof BodyLimitError)) return tooLarge();
      return this.#transportFailure(error, transport, context.url.pathname);
    }
    return stripHopByHop(response);
  }

  /** Maps a failed forward onto the documented gateway error responses (ADR 0054 §3). */
  #transportFailure(error: unknown, transport: InstanceTransport, path: string): Response {
    const code = error instanceof InstanceTransportError ? error.code : undefined;
    // A transport that is no longer ready failed because the instance went away.
    if (code === 'instance-offline' || (code === undefined && !transport.ready)) return this.#unavailable();
    if (code === 'timeout') {
      return this.#instanceError(504, 'instance_timeout', 'unknown', 'The instance did not answer in time', false);
    }
    if (code === 'overloaded') {
      return this.#instanceError(502, 'instance_error', 'not-dispatched', 'The instance is overloaded', true);
    }
    logger.warn(formatCompact({
      op: 'gateway_forward_failed',
      path,
      ...(code ? { code } : {}),
      error: error instanceof Error ? error.message : String(error),
    }));
    return this.#instanceError(502, 'instance_error', 'unknown', 'The instance failed to answer', false);
  }

  /**
   * `GET {base}/console/capabilities` (zhinjs/zhin#1250): the RPC types the gateway answers itself,
   * merged with the instance's reply. While the instance is not answering (or predates the route)
   * the reply says `complete: false`, so the Console reads it again later.
   */
  async #capabilities(request: Request, context: RouteContext): Promise<Response> {
    const own = [...this.#rpcHandlers].flatMap(handler => handler.types?.() ?? []);
    const gateway = createConsoleCapabilities({
      rpc: [...(this.#consoleRpc ? Object.values(GATEWAY_RPC) : []), ...own],
      features: [CONSOLE_FEATURES.UNKNOWN_RPC_CODE, CONSOLE_FEATURES.DENIAL_REASONS, CONSOLE_FEATURES.GATEWAY],
    });
    let instance: ConsoleCapabilities = createConsoleCapabilities({ rpc: [], complete: false });
    const transport = this.#readyTransport();
    // An instance that predates the route refuses it (and audits that): ask it once per route table.
    const revision = transport?.routes().revision;
    const missing = this.#capabilitiesMissing;
    if (transport && !(missing?.transport === transport && missing.revision === revision)) {
      try {
        const response = await this.#forward(request, context);
        const body = response.ok ? await response.json().catch(() => null) as { data?: unknown } | null : null;
        const parsed = parseConsoleCapabilities(body?.data);
        if (parsed) instance = parsed;
        else if (response.status === 403 || response.status === 404) this.#capabilitiesMissing = { transport, revision };
      } catch { /* the instance part stays unknown */ }
    }
    return jsonResponse(200, { success: true, data: mergeConsoleCapabilities(gateway, instance) }, { 'cache-control': 'no-store' });
  }

  /**
   * `POST {base}/console/request`: the router authenticated and authorized the route; `gateway.*`
   * types are dispatched here (the dispatcher checks the per-RPC permission), the rest are
   * forwarded to the instance with the body as received.
   */
  async #consoleRequest(request: Request, context: RouteContext): Promise<Response> {
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > this.#maxBody) return tooLarge();
    let bytes: ArrayBuffer;
    try {
      bytes = request.body
        ? await new Response(limitBody(request.body, this.#maxBody)).arrayBuffer()
        : new ArrayBuffer(0);
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (error instanceof BodyLimitError) return tooLarge();
      return jsonResponse(400, { success: false, code: 'invalid_body', error: 'Invalid request body' });
    }
    const type = peekRpcType(bytes);
    const owner = type === undefined
      ? undefined
      : type.startsWith(GATEWAY_RPC_PREFIX) && this.#consoleRpc
        ? this.#consoleRpc
        : [...this.#rpcHandlers].find((handler) => handler.owns(type));
    if (owner) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      } catch {
        return jsonResponse(400, { success: false, code: 'invalid_body', error: 'Invalid JSON body' });
      }
      const claimed = typeof message === 'object' && message !== null && !Array.isArray(message)
        && (!('claims' in owner) || typeof owner.claims !== 'function' || owner.claims(message));
      if (claimed) {
        try {
          return await owner.handle(message, context, this.tokenRegistry);
        } catch (error) {
          if (isDatabaseBusyError(error)) return databaseBusyResponse({ requestId: message.requestId });
          throw error;
        }
      }
    }
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    headers.delete('content-length');
    return this.#forward(new Request(context.url, {
      method: request.method,
      headers,
      signal: request.signal,
      body: bytes,
    }), context);
  }

  /**
   * A `{base}/…` request from the local control socket (`gateway.http.request`, ADR 0054 §6).
   * Without `token` the socket's owner check is the authentication: the request runs as
   * {@link LOCAL_OWNER_PRINCIPAL}. With `token` (an explicit `ZHIN_CONSOLE_TOKEN`) it is
   * authenticated like an HTTP request with that Bearer credential and runs — and is audited — as
   * its principal. Either way the request takes the HTTP route table: gateway-owned routes (e.g.
   * `{base}/auth/me`), the `POST {base}/console/request` split, then the instance. Event streams
   * cannot be carried in one socket reply; the socket handler refuses them. Only the path and query
   * of `path` are used; paths outside `{base}` are refused.
   */
  async localRequest(input: { readonly method: string; readonly path: string; readonly body?: string; readonly token?: string }): Promise<Response> {
    const method = input.method.toUpperCase();
    // `\` is a path separator to the URL parser: `/\evil.com/x` would name another host.
    if (!input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('\\')) {
      return jsonResponse(400, { success: false, code: 'invalid_input', error: 'path must be an absolute path without a host' });
    }
    if (input.body !== undefined && (method === 'GET' || method === 'HEAD')) {
      return jsonResponse(400, { success: false, code: 'invalid_input', error: `${method} requests cannot have a body` });
    }
    const parsed = new URL(input.path, LOCAL_REQUEST_ORIGIN);
    const url = new URL(`${parsed.pathname}${parsed.search}`, LOCAL_REQUEST_ORIGIN);
    const pathname = normalizePath(url.pathname);
    if (!isUnderBase(pathname, this.apiBase)) {
      return jsonResponse(404, { success: false, code: 'not_found', error: `Only ${this.apiBase === '/' ? '/' : `${this.apiBase}/`}… is reachable over the local socket` });
    }
    const headers = new Headers();
    if (input.body !== undefined) headers.set('content-type', 'application/json');
    if (input.token !== undefined) headers.set('authorization', `Bearer ${input.token}`);
    const request = new Request(url, { method, headers, ...(input.body === undefined ? {} : { body: input.body }) });
    return input.token !== undefined
      ? this.#router.handle(request)
      : this.#localRouter.handle(request, { principal: LOCAL_OWNER_PRINCIPAL });
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
          detail: { reason: webSocketDenialReason(principal, pathname) },
          ...(request.remoteAddress ? { ip: request.remoteAddress } : {}),
        });
      } catch { /* audit never breaks a request */ }
      return undefined;
    }
    return principal;
  }
}

/** A gateway route whose database stayed locked past the retry budget answers 503 `database_busy`. */
/** Origin of the URLs `localRequest` builds (never contacted). */
const LOCAL_REQUEST_ORIGIN = 'http://gateway.local';

/** `pathname` is `base` or below it (`base` may be `/`). */
function isUnderBase(pathname: string, base: string): boolean {
  if (base === '/') return pathname.startsWith('/');
  return pathname === base || pathname.startsWith(`${base}/`);
}

function withDatabaseBusy(handler: HttpHandler): HttpHandler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (isDatabaseBusyError(error)) return databaseBusyResponse();
      throw error;
    }
  };
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

/** Reads `type` from a JSON RPC envelope without failing on malformed input. */
function peekRpcType(bytes: ArrayBuffer): string | undefined {
  if (bytes.byteLength === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  } catch {
    return undefined;
  }
}
