import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
  type ServerOptions as HttpsServerOptions,
} from 'node:https';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  createToken,
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
  type GenerationAdmissionGate,
} from '@zhin.js/plugin-runtime';
import {
  TokenRegistry,
  extractBearerToken,
  isDemoWebSocketPath,
  type AuthenticatedTokenPrincipal,
  type AuthScope,
  type ScopedTokenConfig,
  type TokenRegistryConfig,
} from './token-registry.js';
import {
  buildOpenApiDocument,
  type ListedRoute,
  type RouteMeta,
} from './openapi.js';
import { isDemoHttpAllowed } from './console-rpc.js';
import { HttpBodyError } from './json-body.js';

const logger = getLogger('http');

export const REMOTE_CONSOLE_ORIGIN = 'https://console.zhin.dev';
const DEFAULT_CORS_ORIGINS = Object.freeze([REMOTE_CONSOLE_ORIGIN]);

export interface WsConnection {
  readonly socket: WebSocket;
  readonly request: IncomingMessage;
  readonly authScope: AuthScope;
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

export interface HttpHostAddress {
  readonly host: string;
  readonly port: number;
  readonly protocol: 'http' | 'https';
  readonly secure: boolean;
  readonly origin: string;
}

export interface HttpHostTlsOptions {
  readonly key: NonNullable<HttpsServerOptions['key']>;
  readonly cert: NonNullable<HttpsServerOptions['cert']>;
  readonly ca?: HttpsServerOptions['ca'];
  readonly passphrase?: string;
  readonly minVersion?: HttpsServerOptions['minVersion'];
  readonly ciphers?: string;
}

export interface HttpHostOptions {
  readonly host?: string;
  readonly port?: number;
  /** Primary full-scope Bearer token (`http.token`). */
  readonly token?: string;
  /** Additional scoped tokens (`http.tokens`). */
  readonly tokens?: readonly ScopedTokenConfig[];
  /** CORS allowlist; always merged with Remote Console origin. */
  readonly corsOrigins?: readonly string[];
  /**
   * Paths under this prefix require Bearer auth when a token registry is configured.
   * Defaults to `/api`. `/pub/*`, Console shell, and page routes stay public.
   */
  readonly apiBase?: string;
  /** Extra HTTP path prefixes that skip auth even under `apiBase`. */
  readonly authExemptPaths?: readonly string[];
  /** Enables HTTPS and WSS on this listener. Certificate lifecycle belongs to the process composition root. */
  readonly tls?: HttpHostTlsOptions;
}

export type HttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  authScope: AuthScope,
  authenticatedPrincipal?: AuthenticatedTokenPrincipal,
) => void | Promise<void>;

export interface HttpRouteRegistration {
  (): void;
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

/** @internal Process-root lifecycle and generation admission surface. */
export interface ProcessHttpHost extends HttpHost, GenerationAdmissionBindable<HttpHost> {
  listen(): Promise<HttpHostAddress>;
  close(): Promise<void>;
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

/** @public Stable Plugin Runtime HTTP Host token. */
export const httpHostToken = createToken<HttpHost>('zhin.host.http');

/** @internal CLI composition-root factory. */
export function createHttpHost(options: HttpHostOptions = {}): ProcessHttpHost {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8086;
  const apiBase = normalizePath(options.apiBase ?? '/api');
  const corsOrigins = Object.freeze([
    ...new Set([...DEFAULT_CORS_ORIGINS, ...(options.corsOrigins ?? [])]),
  ]);
  const authExempt = Object.freeze(
    (options.authExemptPaths ?? []).map((path) => normalizePath(path)),
  );
  const tokenRegistry = new TokenRegistry({
    primaryToken: options.token,
    scopedTokens: options.tokens,
  } satisfies TokenRegistryConfig);
  const wsRoutes = new Map<string, Set<WsRoute>>();
  const httpRoutes: HttpRoute[] = [];
  let address: HttpHostAddress | undefined;
  let closed = false;
  let closeResult: Promise<void> | undefined;

  const secure = options.tls !== undefined;
  const handleRequest = (request: IncomingMessage, response: ServerResponse): void => {
    void dispatchHttp(request, response);
  };
  const server: HttpServer | HttpsServer = secure
    ? createHttpsServer(options.tls, handleRequest)
    : createHttpServer(handleRequest);

  // Track live TCP sockets so close() can destroy long-lived connections
  // (SSE /api/events, keep-alive) that would otherwise block server.close().
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  // Built-in public health probe (parity with host-router `/pub/health`).
  httpRoutes.push(Object.freeze({
    method: 'GET',
    path: '/pub/health',
    pattern: '/pub/health',
    prefix: false,
    meta: Object.freeze({ summary: 'Health probe', tags: ['pub'] }),
    handler: (_request: IncomingMessage, response: ServerResponse) => {
      writeJson(response, 200, {
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  }));

  // OpenAPI catalog (parity with host-router `/pub/openapi.json`).
  httpRoutes.push(Object.freeze({
    method: 'GET',
    path: '/pub/openapi.json',
    pattern: '/pub/openapi.json',
    prefix: false,
    meta: Object.freeze({ summary: 'OpenAPI 3.1 document', tags: ['pub'] }),
    handler: (request: IncomingMessage, response: ServerResponse) => {
      const hostHeader = headerValue(request.headers.host) ?? 'localhost';
      const proto = headerValue(request.headers['x-forwarded-proto']) ?? (secure ? 'https' : 'http');
      writeJson(response, 200, buildOpenApiDocument(listListedRoutes(), {
        apiBase,
        serverUrl: `${proto}://${hostHeader}`,
        version: process.env.npm_package_version ?? '0.0.0',
      }));
    },
  }));

  server.on('upgrade', (request, socket, head) => {
    if (closed) {
      socket.destroy();
      return;
    }
    const pathname = upgradePath(request.url);
    const listeners = wsRoutes.get(pathname);
    const admitted = listeners ? [...listeners].flatMap((entry) => {
      const release = entry.admission?.acquire();
      if (entry.admission && !release) return [];
      return [{ entry, release }];
    }) : [];
    if (admitted.length === 0) {
      logger.debug(formatCompact({ op: 'ws_upgrade_unmatched', path: pathname }));
      socket.destroy();
      return;
    }
    const protocolAuthenticated = admitted.every(({ entry }) => entry.options.auth === 'protocol');
    const auth = protocolAuthenticated
      ? { ok: true as const, scope: 'full' as const }
      : authenticateUpgrade(request, pathname);
    if (!auth.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      for (const item of admitted) item.release?.();
      return;
    }
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        let settled = false;
        const retireSubscriptions: Array<() => void> = [];
        const releaseAdmissions = () => {
          if (settled) return;
          settled = true;
          for (const dispose of retireSubscriptions) dispose();
          for (const item of admitted) item.release?.();
        };
        ws.once('close', releaseAdmissions);
        ws.once('error', releaseAdmissions);
        for (const item of admitted) {
          if (item.entry.admission) {
            retireSubscriptions.push(item.entry.admission.onDeactivate(() => {
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close(1012, 'Generation retired');
              }
            }));
          }
        }
        const connection = Object.freeze({
          socket: ws,
          request,
          authScope: auth.scope,
        });
        for (const item of admitted) item.entry.listener(connection);
      });
    } catch (err) {
      for (const item of admitted) item.release?.();
      logger.warn(formatCompact({
        op: 'ws_upgrade_failed',
        path: pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      try {
        socket.destroy();
      } catch {
        /* already destroyed */
      }
    }
  });

  function authenticateUpgrade(
    request: IncomingMessage,
    pathname: string,
  ): { ok: true; scope: AuthScope } | { ok: false } {
    if (!tokenRegistry.hasAnyToken()) return { ok: true, scope: 'full' };
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      return { ok: false };
    }
    const token = extractBearerToken(
      headerValue(request.headers.authorization),
      url.searchParams.get('token'),
    );
    const scope = tokenRegistry.resolve(token);
    if (!scope) return { ok: false };
    if (scope === 'demo' && !isDemoWebSocketPath(pathname)) return { ok: false };
    return { ok: true, scope };
  }

  async function dispatchHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (closed) {
      response.writeHead(503);
      response.end();
      return;
    }
    const method = (request.method ?? 'GET').toUpperCase();
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const pathname = normalizePath(url.pathname);
    const origin = headerValue(request.headers.origin);
    const corsOk = corsMatch(origin, corsOrigins);

    if (method === 'OPTIONS') {
      if (corsOk && origin) applyCors(response, origin, corsOrigins);
      response.writeHead(204);
      response.end();
      return;
    }

    const auth = authenticateHttp(request, url, pathname);
    if (!auth.ok) {
      if (corsOk && origin) applyCors(response, origin, corsOrigins);
      writeJson(response, 401, { success: false, error: 'Invalid or missing token' });
      return;
    }

    const route = matchHttpRoute(httpRoutes, method, pathname);
    if (!route) {
      if (corsOk && origin) applyCors(response, origin, corsOrigins);
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      if (corsOk && origin) applyCors(response, origin, corsOrigins);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'SAMEORIGIN');
      const release = route.admission?.acquire();
      if (route.admission && !release) {
        response.writeHead(503);
        response.end();
        return;
      }
      if (!release) {
        await route.handler(request, response, url, auth.scope, auth.principal);
        return;
      }
      let released = false;
      const releaseResponse = () => {
        if (released) return;
        released = true;
        response.off('finish', releaseResponse);
        response.off('close', releaseResponse);
        release();
      };
      response.once('finish', releaseResponse);
      response.once('close', releaseResponse);
      await route.handler(request, response, url, auth.scope, auth.principal);
      if (response.writableFinished || response.destroyed) releaseResponse();
    } catch (err) {
      // 统一把请求体错误（400/413）映射回对应状态码，
      // 避免个别端点未捕获时退化成 500 空响应。
      if (err instanceof HttpBodyError) {
        if (!response.headersSent) {
          writeJson(response, err.statusCode, { success: false, error: err.message });
        }
        return;
      }
      logger.warn(formatCompact({
        op: 'http_handler_failed',
        path: pathname,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!response.headersSent) {
        response.writeHead(500);
        response.end();
      }
    }
  }

  function authenticateHttp(
    request: IncomingMessage,
    url: URL,
    pathname: string,
  ): { ok: true; scope: AuthScope; principal?: AuthenticatedTokenPrincipal } | { ok: false } {
    if (!requiresHttpAuth(pathname, apiBase, authExempt)) {
      return { ok: true, scope: 'full' };
    }
    if (!tokenRegistry.hasAnyToken()) {
      return { ok: true, scope: 'full' };
    }
    const token = extractBearerToken(
      headerValue(request.headers.authorization),
      url.searchParams.get('token'),
    );
    const scope = tokenRegistry.resolve(token);
    if (!scope) return { ok: false };
    if (scope === 'demo') {
      const method = (request.method ?? 'GET').toUpperCase();
      if (!isDemoHttpAllowed(method, pathname, apiBase)) return { ok: false };
    }
    const principal = tokenRegistry.resolvePrincipal(token);
    return { ok: true, scope, ...(principal ? { principal } : {}) };
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
    options: WsRouteOptions = {},
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
        const entry = Object.freeze({ listener, admission, options: Object.freeze({ ...options }) });
        listeners!.add(entry);
        owned.add(entry);
        return () => {
          listeners!.delete(entry);
          owned.delete(entry);
        };
      },
      close() {
        for (const entry of owned) listeners!.delete(entry);
        owned.clear();
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
    return () => {
      const index = httpRoutes.indexOf(entry);
      if (index >= 0) httpRoutes.splice(index, 1);
    };
  }

  function createBoundHost(
    admission: GenerationAdmissionGate,
  ): AdmissionBoundHttpHost {
    const bound: AdmissionBoundHttpHost = {
      [generationAdmissionBinder]: (next) => createBoundHost(next),
      ws: (path, options) => registerWs(path, admission, options),
      route: (method, path, handler, meta) => registerRoute(
        method,
        path,
        handler,
        meta,
        admission,
      ),
      listRoutes: () => listListedRoutes(),
      get address() { return runtime.address; },
      get tokenRegistry() { return tokenRegistry; },
    };
    return Object.freeze(bound);
  }

  const runtime: ProcessHttpHost = {
    [generationAdmissionBinder]: (admission) => createBoundHost(admission),

    ws: (pathname, options) => registerWs(pathname, undefined, options),

    route: (method, path, handler, meta) => registerRoute(method, path, handler, meta),

    listRoutes(): readonly ListedRoute[] {
      return listListedRoutes();
    },

    get address() {
      return address;
    },

    get tokenRegistry() {
      return tokenRegistry;
    },

    listen(): Promise<HttpHostAddress> {
      if (address) return Promise.resolve(address);
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host, port }, () => {
          server.off('error', reject);
          const bound = server.address();
          const listenPort = typeof bound === 'object' && bound ? bound.port : port;
          const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
          const protocol = secure ? 'https' : 'http';
          const originHost = publicHost.includes(':') ? `[${publicHost}]` : publicHost;
          address = Object.freeze({
            host: publicHost, port: listenPort, protocol, secure,
            origin: `${protocol}://${originHost}:${listenPort}`,
          });
          logger.info(
            `listening ${address.origin}`
            + ` | routes: ${httpRoutes.length}`
            + ` | token: ${tokenRegistry.hasAnyToken()
              ? `${tokenRegistry.primaryTokenPrefixForLog()}…`
              : '(none)'}`,
          );
          logger.debug(
            `listen detail | cors: ${corsOrigins.join(',')}`
            + ` | ws: ${[...wsRoutes.keys()].join(',') || '(none)'}`,
          );
          resolve(address);
        });
      });
    },

    close(): Promise<void> {
      if (closeResult) return closeResult;
      closed = true;
      wsRoutes.clear();
      httpRoutes.length = 0;
      // Rollback paths dispose a host whose generation never reached listen().
      if (!server.listening) {
        address = undefined;
        closeResult = Promise.resolve();
        return closeResult;
      }
      closeResult = new Promise((resolve, reject) => {
        // Long-lived connections (SSE, keep-alive, WS) never end on their own:
        // destroy tracked sockets and terminate WS clients before close(),
        // otherwise the close callbacks would never fire.
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        for (const client of wss.clients) client.terminate();
        wss.close((wssError) => {
          if (wssError) {
            reject(wssError);
            return;
          }
          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }
            logger.debug(formatCompact({ op: 'http_host_closed' }));
            address = undefined;
            resolve();
          });
        });
      });
      return closeResult;
    },
  };
  return runtime;
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

function applyCors(
  response: ServerResponse,
  origin: string,
  allowed: readonly string[],
): void {
  response.setHeader(
    'Access-Control-Allow-Origin',
    allowed.includes('*') ? '*' : origin,
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
  response.setHeader('Access-Control-Max-Age', '86400');
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
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

function normalizePath(pathname: string): string {
  if (!pathname.startsWith('/')) return `/${pathname}`;
  // 线性裁剪尾部斜杠（等价于 /\/+$/u，但避免长串 `/` 无匹配时的
  // 二次方回溯 — js/polynomial-redos）。
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === '/') end -= 1;
  return pathname.slice(0, end) || '/';
}

function upgradePath(url: string | undefined): string {
  try {
    return normalizePath(new URL(url ?? '/', 'http://localhost').pathname);
  } catch {
    return '/';
  }
}
