import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  TokenRegistry,
  extractBearerToken,
  isDemoWebSocketPath,
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

const logger = getLogger('HttpHost');

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

export interface HttpHostAddress {
  readonly host: string;
  readonly port: number;
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
}

export type HttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  authScope: AuthScope,
) => void | Promise<void>;

export interface HttpRouteRegistration {
  (): void;
}

export interface HttpHost {
  ws(path: string): WsHandle;
  route(
    method: string,
    path: string,
    handler: HttpHandler,
    meta?: RouteMeta,
  ): HttpRouteRegistration;
  listRoutes(): readonly ListedRoute[];
  listen(): Promise<HttpHostAddress>;
  close(): Promise<void>;
  get address(): HttpHostAddress | undefined;
  get tokenRegistry(): TokenRegistry;
}

interface HttpRoute {
  readonly method: string;
  readonly path: string;
  readonly pattern: string;
  readonly prefix: boolean;
  readonly handler: HttpHandler;
  readonly meta?: RouteMeta;
}

export const httpHostToken = createToken<HttpHost>('zhin.host.http');

export function createHttpHost(options: HttpHostOptions = {}): HttpHost {
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
  const wsRoutes = new Map<string, Set<(connection: WsConnection) => void>>();
  const httpRoutes: HttpRoute[] = [];
  let address: HttpHostAddress | undefined;
  let closed = false;

  const server: Server = createServer((request, response) => {
    void dispatchHttp(request, response);
  });

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
      const proto = headerValue(request.headers['x-forwarded-proto']) ?? 'http';
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
    if (!listeners || listeners.size === 0) {
      logger.debug(formatCompact({ op: 'ws_upgrade_unmatched', path: pathname }));
      socket.destroy();
      return;
    }
    const auth = authenticateUpgrade(request, pathname);
    if (!auth.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const connection = Object.freeze({
          socket: ws,
          request,
          authScope: auth.scope,
        });
        for (const listener of listeners) listener(connection);
      });
    } catch (err) {
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
      await route.handler(request, response, url, auth.scope);
    } catch (err) {
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
  ): { ok: true; scope: AuthScope } | { ok: false } {
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
    return { ok: true, scope };
  }

  function listListedRoutes(): readonly ListedRoute[] {
    return Object.freeze(httpRoutes.map((route) => Object.freeze({
      method: route.method,
      pattern: route.pattern,
      meta: route.meta,
    })));
  }

  return {
    ws(pathname: string): WsHandle {
      const normalized = normalizePath(pathname);
      let listeners = wsRoutes.get(normalized);
      if (!listeners) {
        listeners = new Set();
        wsRoutes.set(normalized, listeners);
      }
      const owned = new Set<(connection: WsConnection) => void>();
      return {
        onConnection(listener) {
          listeners!.add(listener);
          owned.add(listener);
          return () => {
            listeners!.delete(listener);
            owned.delete(listener);
          };
        },
        close() {
          for (const listener of owned) listeners!.delete(listener);
          owned.clear();
        },
      };
    },

    route(
      method: string,
      path: string,
      handler: HttpHandler,
      meta?: RouteMeta,
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
      });
      httpRoutes.push(entry);
      return () => {
        const index = httpRoutes.indexOf(entry);
        if (index >= 0) httpRoutes.splice(index, 1);
      };
    },

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
          address = Object.freeze({ host: publicHost, port: listenPort });
          logger.info(formatCompact({
            http: `http://${publicHost}:${listenPort}`,
            token: tokenRegistry.hasAnyToken()
              ? `${tokenRegistry.primaryTokenPrefixForLog()}…`
              : '(none)',
            cors: corsOrigins.join(','),
            ws_routes: [...wsRoutes.keys()].join(',') || '(none)',
            http_routes: httpRoutes.length,
          }));
          resolve(address);
        });
      });
    },

    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      wsRoutes.clear();
      httpRoutes.length = 0;
      // Rollback paths dispose a host whose generation never reached listen().
      if (!server.listening) {
        address = undefined;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
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
    },
  };
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
