/**
 * Transport-independent HTTP/WebSocket route surface (ADR 0054 §2).
 *
 * Routes take a Web standard `Request` and return a `Response`; WebSocket routes
 * receive a {@link WsConnection}. The router owns matching, CORS, Console
 * authentication and generation admission. A transport (the in-process Node
 * server in `@zhin.js/host-http/node`, later the gateway bridge) feeds it
 * `Request`s and upgrade requests. Nothing here imports `node:http` or `ws`.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createToken,
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
  type GenerationAdmissionGate,
} from '@zhin.js/plugin-runtime';
import { HttpBodyError, jsonResponse, type HttpRouteContext } from '@zhin.js/host-http-contract';
import {
  TokenRegistry,
  extractBearerToken,
  type TokenRegistryConfig,
} from './token-registry.js';
import {
  buildOpenApiDocument,
  type ListedRoute,
  type RouteMeta,
} from './openapi.js';
import {
  auditActor,
  authorizeConsoleHttp,
  authorizeConsoleWebSocket,
  requestMeta,
  type ConsolePrincipal,
} from './access-control.js';
import type { HttpHostAddress } from './host-options.js';

export type { HttpHostAddress } from './host-options.js';

const logger = getLogger('http');

export const REMOTE_CONSOLE_ORIGIN = 'https://console.zhin.dev';
const DEFAULT_CORS_ORIGINS = Object.freeze([REMOTE_CONSOLE_ORIGIN]);

/** Per-request data resolved by the Host before a route runs. */
export interface RouteContext extends HttpRouteContext {
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  /**
   * Console principal the Host authenticated. Set for `{apiBase}` routes and for public
   * routes that presented a valid credential; absent otherwise.
   */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

export type HttpHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;

export interface HttpRouteRegistration {
  (): void;
}

/** An accepted WebSocket, independent of the transport that carries it. */
export interface WsConnection {
  readonly url: URL;
  readonly headers: Headers;
  /** Authenticated principal (absent for `auth: 'protocol'` routes, which authenticate themselves). */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
  /** Text frames as strings, binary frames as bytes. Dropped once the socket is closing. */
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
  /** Bytes queued but not yet sent (backpressure). */
  readonly bufferedAmount: number;
}

export interface WsHandle {
  onConnection(listener: (connection: WsConnection) => void): () => void;
  close(): void;
}

export interface WsRouteOptions {
  /**
   * `host` applies the Host Bearer-token registry before upgrade. `protocol`
   * leaves upgrade authentication to the registered application protocol.
   */
  readonly auth?: 'host' | 'protocol';
}

/** @public Stable HTTP and WebSocket Host contract resolved through `httpHostToken`. */
export interface HttpHost {
  ws(path: string, options?: WsRouteOptions): WsHandle;
  route(
    method: string,
    path: string,
    handler: HttpHandler,
    meta?: RouteMeta,
  ): HttpRouteRegistration;
  listRoutes(): readonly ListedRoute[];
  get address(): HttpHostAddress | undefined;
  /** @internal Console authentication registry owned by the process Host. */
  get tokenRegistry(): TokenRegistry;
}

/** @public Stable Plugin Runtime HTTP Host token. */
export const httpHostToken = createToken<HttpHost>('zhin.host.http');

export interface HttpRouterOptions {
  /** Bootstrap Bearer token (`http.token`), accepted only until the first owner exists. */
  readonly token?: string;
  /** CORS allowlist; always merged with Remote Console origin. */
  readonly corsOrigins?: readonly string[];
  /**
   * Paths under this prefix require Bearer auth when a token registry is configured.
   * Defaults to `/api`. `/pub/*`, Console shell, and page routes stay public.
   */
  readonly apiBase?: string;
  /** Extra HTTP path prefixes that skip auth even under `apiBase`. */
  readonly authExemptPaths?: readonly string[];
  /** Shared registry for listener groups; `token` is ignored when set. */
  readonly tokenRegistry?: TokenRegistry;
  /** Whether the carrying transport is TLS (OpenAPI server URL default). */
  readonly secure?: boolean;
  /** Bound listener address as reported by the transport. */
  readonly address?: () => HttpHostAddress | undefined;
  /**
   * Who authenticates requests (ADR 0054 §3):
   * - `credentials` (default): the router resolves the Bearer / `?token=` credential through
   *   {@link TokenRegistry}. A `principal` passed by the transport is ignored.
   * - `forwarded`: the carrying transport already authenticated the request (the gateway, over
   *   the bridge) and passes the principal in {@link HttpRequestInfo.principal} /
   *   {@link WsUpgradeRequest.principal}. The router never parses credentials itself but still
   *   authorizes every `{apiBase}` route and host-authenticated socket against the Console
   *   permission map, exactly as in `credentials` mode. A missing principal is anonymous.
   */
  readonly authentication?: 'credentials' | 'forwarded';
  /**
   * Register the built-in `/pub/health` and `/pub/openapi.json` routes (default true). The
   * gateway turns them off: it owns its own health probe and forwards the instance's catalog.
   */
  readonly builtinRoutes?: boolean;
}

export interface HttpRequestInfo {
  readonly remoteAddress?: string;
  /** Pre-authenticated principal; honoured only by a `forwarded` router. */
  readonly principal?: ConsolePrincipal;
}

export interface WsUpgradeRequest {
  readonly url: URL;
  readonly headers: Headers;
  readonly remoteAddress?: string;
  /** Pre-authenticated principal; honoured only by a `forwarded` router. */
  readonly principal?: ConsolePrincipal;
}

/** A registered WebSocket path and how it authenticates (admission-active only). */
export interface ListedWsRoute {
  readonly path: string;
  readonly auth: 'host' | 'protocol';
}

/** The transport half of a {@link WsConnection}. */
export interface WsTransport {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
  readonly bufferedAmount: number;
}

export type WsUpgradeDecision =
  | Readonly<{
    accepted: false;
    /** 404 drops the socket silently; other statuses are written as a bare HTTP response. */
    status: 401 | 404 | 503;
    /** Extra response headers for the refusal (e.g. `Retry-After`). */
    headers?: Readonly<Record<string, string>>;
  }>
  | Readonly<{
    accepted: true;
    /** Hand the established socket to the route listeners. */
    accept(transport: WsTransport): void;
    /** The transport failed to complete the handshake. */
    reject(): void;
  }>;

/** @internal Transport-facing router; `createHttpHost` (node) and the gateway bridge drive it. */
export interface HttpRouter extends HttpHost, GenerationAdmissionBindable<HttpHost> {
  handle(request: Request, info?: HttpRequestInfo): Promise<Response>;
  upgrade(request: WsUpgradeRequest): Promise<WsUpgradeDecision>;
  readonly routeCount: number;
  readonly wsPaths: readonly string[];
  /** Admission-active WebSocket routes (`protocol` only when every listener uses it). */
  listWsRoutes(): readonly ListedWsRoute[];
  /** Called after any route or socket registration changes (not on admission changes). */
  onRoutesChanged(listener: () => void): () => void;
  readonly apiBase: string;
  readonly corsOrigins: readonly string[];
  /** Terminal: routes are dropped and every later request gets 503. */
  close(): void;
}

interface HttpRoute {
  readonly method: string;
  readonly path: string;
  readonly pattern: string;
  readonly prefix: boolean;
  readonly handler: HttpHandler;
  readonly meta?: RouteMeta;
  readonly admission?: GenerationAdmissionGate;
}

interface AdmissionBoundHttpHost extends HttpHost, GenerationAdmissionBindable<HttpHost> {}

interface WsRoute {
  readonly listener: (connection: WsConnection) => void;
  readonly admission?: GenerationAdmissionGate;
  readonly options: WsRouteOptions;
}

const NO_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

export function createHttpRouter(options: HttpRouterOptions = {}): HttpRouter {
  const apiBase = normalizePath(options.apiBase ?? '/api');
  const corsOrigins = Object.freeze([
    ...new Set([...DEFAULT_CORS_ORIGINS, ...(options.corsOrigins ?? [])]),
  ]);
  const authExempt = Object.freeze(
    (options.authExemptPaths ?? []).map((path) => normalizePath(path)),
  );
  const tokenRegistry = options.tokenRegistry ?? new TokenRegistry({
    primaryToken: options.token,
  } satisfies TokenRegistryConfig);
  const secure = options.secure === true;
  const readAddress = options.address ?? (() => undefined);
  const forwarded = options.authentication === 'forwarded';
  const wsRoutes = new Map<string, Set<WsRoute>>();
  const httpRoutes: HttpRoute[] = [];
  const changeListeners = new Set<() => void>();
  let closed = false;
  const routesChanged = (): void => {
    for (const listener of [...changeListeners]) {
      try { listener(); } catch { /* observers never break registration */ }
    }
  };

  if (options.builtinRoutes !== false) registerBuiltinRoutes();

  function registerBuiltinRoutes(): void {
    // Built-in public health probe (parity with host-router `/pub/health`).
    httpRoutes.push(Object.freeze({
      method: 'GET',
      path: '/pub/health',
      pattern: '/pub/health',
      prefix: false,
      meta: Object.freeze({ summary: 'Health probe', tags: ['pub'] }),
      handler: () => jsonResponse(200, {
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
    }));

    // OpenAPI catalog (parity with host-router `/pub/openapi.json`).
    httpRoutes.push(Object.freeze({
      method: 'GET',
      path: '/pub/openapi.json',
      pattern: '/pub/openapi.json',
      prefix: false,
      meta: Object.freeze({ summary: 'OpenAPI 3.1 document', tags: ['pub'] }),
      handler: (request: Request) => {
        const hostHeader = request.headers.get('host') ?? 'localhost';
        const proto = request.headers.get('x-forwarded-proto') ?? (secure ? 'https' : 'http');
        return jsonResponse(200, buildOpenApiDocument(listListedRoutes(), {
          apiBase,
          serverUrl: `${proto}://${hostHeader}`,
          version: process.env.npm_package_version ?? '0.0.0',
        }));
      },
    }));
  }

  async function authenticateUpgrade(
    request: WsUpgradeRequest,
    pathname: string,
  ): Promise<ConsolePrincipal | undefined> {
    const { url, headers, remoteAddress } = request;
    const principal = forwarded
      ? request.principal
      : await tokenRegistry.authenticate(
        extractBearerToken(headers.get('authorization') ?? undefined, url.searchParams.get('token')),
        requestMeta({ headers }, remoteAddress),
      );
    if (!principal) return undefined;
    if (!authorizeConsoleWebSocket(principal, pathname)) {
      audit(principal, remoteAddress, `ws:${pathname}`, 'denied');
      return undefined;
    }
    return principal;
  }

  function audit(
    principal: ConsolePrincipal | undefined,
    remoteAddress: string | undefined,
    action: string,
    outcome: 'ok' | 'denied' | 'error',
  ): void {
    const sink = tokenRegistry.accessProvider?.audit;
    if (!sink) return;
    try {
      sink.call(tokenRegistry.accessProvider, {
        actor: auditActor(principal),
        action,
        outcome,
        ...(remoteAddress ? { ip: remoteAddress } : {}),
      });
    } catch { /* audit never breaks a request */ }
  }

  async function upgrade(request: WsUpgradeRequest): Promise<WsUpgradeDecision> {
    if (closed) return Object.freeze({ accepted: false, status: 404 });
    const pathname = normalizePath(request.url.pathname);
    const listeners = wsRoutes.get(pathname);
    const admitted = listeners ? [...listeners].flatMap((entry) => {
      const release = entry.admission?.acquire();
      if (entry.admission && !release) return [];
      return [{ entry, release }];
    }) : [];
    if (admitted.length === 0) {
      logger.debug(formatCompact({ op: 'ws_upgrade_unmatched', path: pathname }));
      return Object.freeze({ accepted: false, status: 404 });
    }
    let settled = false;
    const releaseAll = (): void => {
      if (settled) return;
      settled = true;
      for (const item of admitted) item.release?.();
    };
    const protocolAuthenticated = admitted.every(({ entry }) => entry.options.auth === 'protocol');
    let principal: ConsolePrincipal | undefined;
    if (!protocolAuthenticated) {
      principal = await authenticateUpgrade(request, pathname).catch(() => undefined);
      if (!principal || closed) {
        releaseAll();
        return Object.freeze({ accepted: false, status: 401 });
      }
    }
    return Object.freeze({
      accepted: true as const,
      reject: releaseAll,
      accept(transport: WsTransport): void {
        if (settled) {
          transport.close(1012, 'Root stopped');
          return;
        }
        const stopSubscriptions: Array<() => void> = [];
        let finished = false;
        transport.onClose(() => {
          if (finished) return;
          finished = true;
          for (const unsubscribe of stopSubscriptions) unsubscribe();
          releaseAll();
        });
        // Replacement closes new upgrades, not accepted plugin work. Explicit Root stop
        // still closes its sockets before waiting for their admission leases to drain.
        const stops = new Set(admitted.map(item => item.entry.admission?.stopSignal).filter(signal => signal !== undefined));
        for (const signal of stops) {
          const stop = () => {
            if (!finished) transport.close(1012, 'Root stopped');
          };
          signal.addEventListener('abort', stop, { once: true });
          stopSubscriptions.push(() => signal.removeEventListener('abort', stop));
          if (signal.aborted) stop();
        }
        const connection: WsConnection = Object.freeze({
          url: request.url,
          headers: request.headers,
          ...(principal ? { principal } : {}),
          ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}),
          send: (data: string | Uint8Array) => transport.send(data),
          close: (code?: number, reason?: string) => transport.close(code, reason),
          onMessage: (listener: (data: string | Uint8Array) => void) => transport.onMessage(listener),
          onClose: (listener: (code: number, reason: string) => void) => transport.onClose(listener),
          get bufferedAmount() { return transport.bufferedAmount; },
        });
        for (const item of admitted) {
          try {
            item.entry.listener(connection);
          } catch (error) {
            logger.warn(formatCompact({
              op: 'ws_listener_failed',
              path: pathname,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      },
    });
  }

  async function handle(request: Request, info: HttpRequestInfo = {}): Promise<Response> {
    if (closed) return new Response(null, { status: 503 });
    const method = request.method.toUpperCase();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    const pathname = normalizePath(url.pathname);
    const origin = request.headers.get('origin') ?? undefined;
    const cors = origin && corsMatch(origin, corsOrigins) ? corsHeaders(origin, corsOrigins) : undefined;

    if (method === 'OPTIONS') return withHeaders(new Response(null, { status: 204 }), cors);

    const auth = await authenticateHttp(request, url, pathname, method, info);
    if (!auth.ok) {
      return withHeaders(jsonResponse(auth.status, {
        success: false,
        code: auth.code,
        requestOutcome: 'not-dispatched',
        error: auth.error,
      }), cors);
    }

    const route = matchHttpRoute(httpRoutes, method, pathname);
    if (!route) return withHeaders(new Response(null, { status: 404 }), cors);
    const defaults = { ...cors, 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' };
    const release = route.admission?.acquire();
    if (route.admission && !release) {
      return withHeaders(jsonResponse(503, { success: false, code: 'unavailable', requestOutcome: 'not-dispatched' }), defaults);
    }
    const context: RouteContext = Object.freeze({
      url,
      params: route.prefix ? Object.freeze({ '*': prefixRemainder(route.path, pathname) }) : NO_PARAMS,
      ...(auth.principal ? { principal: auth.principal } : {}),
      ...(info.remoteAddress ? { remoteAddress: info.remoteAddress } : {}),
    });
    let response: Response;
    try {
      response = await route.handler(request, context);
      if (!(response instanceof Response)) throw new TypeError('HTTP route handler did not return a Response');
    } catch (err) {
      release?.();
      // 统一把请求体错误（400/413）映射回对应状态码，
      // 避免个别端点未捕获时退化成 500 空响应。
      if (err instanceof HttpBodyError) {
        return withHeaders(jsonResponse(err.statusCode, { success: false, error: err.message }), defaults);
      }
      logger.warn(formatCompact({
        op: 'http_handler_failed',
        path: pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      return withHeaders(new Response(null, { status: 500 }), defaults);
    }
    return withHeaders(response, defaults, release);
  }

  async function authenticateHttp(
    request: Request,
    url: URL,
    pathname: string,
    method: string,
    info: HttpRequestInfo,
  ): Promise<
    | { ok: true; principal?: ConsolePrincipal }
    | { ok: false; status: 401 | 403; code: string; error: string }
  > {
    const remoteAddress = info.remoteAddress;
    if (forwarded) {
      // The gateway authenticated; authorization still happens here (ADR 0054 §3).
      const principal = info.principal;
      if (!requiresHttpAuth(pathname, apiBase, authExempt)) return { ok: true, ...(principal ? { principal } : {}) };
      return authorizeApi(principal, method, pathname, remoteAddress);
    }
    const token = extractBearerToken(
      request.headers.get('authorization') ?? undefined,
      url.searchParams.get('token'),
    );
    const meta = requestMeta(request, remoteAddress);
    if (!requiresHttpAuth(pathname, apiBase, authExempt)) {
      // Public route: still attach a presented credential so page catalogs can filter by it.
      if (token || !tokenRegistry.hasAnyToken()) {
        const principal = await tokenRegistry.authenticate(token, meta);
        if (principal) return { ok: true, principal };
      }
      return { ok: true };
    }
    const principal = await tokenRegistry.authenticate(token, meta) ?? undefined;
    return authorizeApi(principal, method, pathname, remoteAddress);
  }

  function authorizeApi(
    principal: ConsolePrincipal | undefined,
    method: string,
    pathname: string,
    remoteAddress: string | undefined,
  ): { ok: true; principal?: ConsolePrincipal } | { ok: false; status: 401 | 403; code: string; error: string } {
    const relative = pathname === apiBase ? '/' : pathname.slice(apiBase.length);
    const decision = authorizeConsoleHttp(principal, method, relative);
    if (!decision.allowed) {
      if (principal) audit(principal, remoteAddress, `http:${method} ${relative}`, 'denied');
      return { ok: false, status: decision.status, code: decision.code, error: decision.error };
    }
    return { ok: true, ...(principal ? { principal } : {}) };
  }

  function listListedRoutes(): readonly ListedRoute[] {
    return Object.freeze(httpRoutes
      .filter((route) => !route.admission || route.admission.active)
      .map((route) => Object.freeze({
        method: route.method,
        pattern: route.pattern,
        meta: route.meta,
      })));
  }

  function registerWs(
    pathname: string,
    admission?: GenerationAdmissionGate,
    wsOptions: WsRouteOptions = {},
  ): WsHandle {
    const normalized = normalizePath(pathname);
    let listeners = wsRoutes.get(normalized);
    if (!listeners) {
      listeners = new Set();
      wsRoutes.set(normalized, listeners);
    }
    const owned = new Set<WsRoute>();
    return {
      onConnection(listener) {
        const entry = Object.freeze({ listener, admission, options: Object.freeze({ ...wsOptions }) });
        listeners!.add(entry);
        owned.add(entry);
        routesChanged();
        return () => {
          if (!owned.delete(entry)) return;
          listeners!.delete(entry);
          routesChanged();
        };
      },
      close() {
        if (owned.size === 0) return;
        for (const entry of owned) listeners!.delete(entry);
        owned.clear();
        routesChanged();
      },
    };
  }

  function registerRoute(
    method: string,
    path: string,
    handler: HttpHandler,
    meta?: RouteMeta,
    admission?: GenerationAdmissionGate,
  ): HttpRouteRegistration {
    const normalizedMethod = method.toUpperCase();
    const prefix = path.endsWith('/*');
    const normalizedPath = normalizePath(prefix ? path.slice(0, -2) : path);
    const pattern = prefix ? `${normalizedPath}/*` : normalizedPath;
    const entry: HttpRoute = Object.freeze({
      method: normalizedMethod,
      path: normalizedPath,
      pattern,
      prefix,
      handler,
      meta,
      admission,
    });
    httpRoutes.push(entry);
    routesChanged();
    return () => {
      const index = httpRoutes.indexOf(entry);
      if (index < 0) return;
      httpRoutes.splice(index, 1);
      routesChanged();
    };
  }

  function createBoundHost(admission: GenerationAdmissionGate): AdmissionBoundHttpHost {
    const bound: AdmissionBoundHttpHost = {
      [generationAdmissionBinder]: (next) => createBoundHost(next),
      ws: (path, wsOptions) => registerWs(path, admission, wsOptions),
      route: (method, path, handler, meta) => registerRoute(method, path, handler, meta, admission),
      listRoutes: () => listListedRoutes(),
      get address() { return readAddress(); },
      get tokenRegistry() { return tokenRegistry; },
    };
    return Object.freeze(bound);
  }

  return {
    [generationAdmissionBinder]: (admission) => createBoundHost(admission),
    ws: (pathname, wsOptions) => registerWs(pathname, undefined, wsOptions),
    route: (method, path, handler, meta) => registerRoute(method, path, handler, meta),
    listRoutes: () => listListedRoutes(),
    get address() { return readAddress(); },
    get tokenRegistry() { return tokenRegistry; },
    handle,
    upgrade,
    get routeCount() { return httpRoutes.length; },
    get wsPaths() { return Object.freeze([...wsRoutes.keys()]); },
    listWsRoutes() {
      const listed: ListedWsRoute[] = [];
      for (const [path, entries] of wsRoutes) {
        const active = [...entries].filter((entry) => !entry.admission || entry.admission.active);
        if (active.length === 0) continue;
        const auth = active.every((entry) => entry.options.auth === 'protocol') ? 'protocol' : 'host';
        listed.push(Object.freeze({ path, auth }));
      }
      return Object.freeze(listed);
    },
    onRoutesChanged(listener) {
      changeListeners.add(listener);
      return () => { changeListeners.delete(listener); };
    },
    apiBase,
    corsOrigins,
    close() {
      closed = true;
      wsRoutes.clear();
      httpRoutes.length = 0;
      changeListeners.clear();
    },
  };
}

/**
 * Adds host default headers (handler headers win) and, when `release` is given, keeps the
 * generation lease until the body is fully delivered or cancelled.
 */
function withHeaders(
  response: Response,
  defaults: Readonly<Record<string, string>> | undefined,
  release?: () => void,
): Response {
  const entries = defaults ? Object.entries(defaults) : [];
  if (entries.length === 0 && !release) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of entries) if (!headers.has(name)) headers.set(name, value);
  let body: ReadableStream<Uint8Array> | null = response.body;
  if (release) {
    if (!body) release();
    else body = releaseWhenDrained(body, release);
  }
  try {
    return new Response(body as BodyInit | null, { status: response.status, statusText: response.statusText, headers });
  } catch {
    // Response.error() and friends cannot be re-wrapped.
    return new Response(null, { status: 500 });
  }
}

function releaseWhenDrained(source: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    release();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  }, { highWaterMark: 0 });
}

function requiresHttpAuth(
  pathname: string,
  apiBase: string,
  authExempt: readonly string[],
): boolean {
  if (pathname === '/pub' || pathname.startsWith('/pub/')) return false;
  if (authExempt.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return false;
  }
  return pathname === apiBase || pathname.startsWith(`${apiBase}/`);
}

function corsMatch(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin || allowed.length === 0) return false;
  return allowed.includes('*')
    || allowed.some((entry) => (
      entry === origin
      || (entry.endsWith('*') && origin.startsWith(entry.slice(0, -1)))
    ));
}

function corsHeaders(origin: string, allowed: readonly string[]): Record<string, string> {
  return {
    'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, Accept',
    'access-control-max-age': '86400',
    // Browsers hide non-safelisted response headers unless exposed (503 instance-unavailable).
    'access-control-expose-headers': 'Retry-After',
  };
}

function matchHttpRoute(routes: readonly HttpRoute[], method: string, pathname: string): HttpRoute | undefined {
  let best: HttpRoute | undefined;
  let bestLength = -1;
  for (const route of routes) {
    if (route.admission && !route.admission.active) continue;
    if (route.method !== method && route.method !== 'ALL') continue;
    if (route.prefix) {
      const matches = route.path === '/'
        ? pathname.startsWith('/')
        : pathname === route.path || pathname.startsWith(`${route.path}/`);
      if (matches && route.path.length > bestLength) {
        best = route;
        bestLength = route.path.length;
      }
      continue;
    }
    if (pathname === route.path && route.path.length >= bestLength) {
      best = route;
      bestLength = route.path.length;
    }
  }
  return best;
}

function prefixRemainder(prefix: string, pathname: string): string {
  if (prefix === '/') return pathname.slice(1);
  return pathname.length > prefix.length ? pathname.slice(prefix.length + 1) : '';
}

export function normalizePath(pathname: string): string {
  if (!pathname.startsWith('/')) return `/${pathname}`;
  // 线性裁剪尾部斜杠（等价于 /\/+$/u，但避免长串 `/` 无匹配时的
  // 二次方回溯 — js/polynomial-redos）。
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === '/') end -= 1;
  return pathname.slice(0, end) || '/';
}
