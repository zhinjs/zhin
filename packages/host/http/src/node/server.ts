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
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
} from '@zhin.js/plugin-runtime';
import { createHttpRouter, type HttpHost } from '../http-host.js';
import type { HttpHostAddress, HttpHostOptions } from '../host-options.js';
import { createNodeRequest, nodeRequestHeaders, writeNodeResponse, wrapNodeWebSocket } from './node-http.js';

const logger = getLogger('http');

/** @internal Process-root lifecycle and generation admission surface. */
export interface ProcessHttpHost extends HttpHost, GenerationAdmissionBindable<HttpHost> {
  listen(): Promise<HttpHostAddress>;
  close(): Promise<void>;
}

/**
 * In-process Node listener for the transport-independent router: Node requests become
 * Web `Request`s, `Response`s are streamed back, `ws` sockets become `WsConnection`s.
 */
export function createHttpHost(options: HttpHostOptions = {}): ProcessHttpHost {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8086;
  const secure = options.tls !== undefined;
  let address: HttpHostAddress | undefined;
  let closed = false;
  let closeResult: Promise<void> | undefined;
  let listenResult: Promise<HttpHostAddress> | undefined;

  const router = createHttpRouter({
    token: options.token,
    corsOrigins: options.corsOrigins,
    apiBase: options.apiBase,
    authExemptPaths: options.authExemptPaths,
    tokenRegistry: options.tokenRegistry,
    secure,
    address: () => address,
  });
  const tokenRegistry = router.tokenRegistry;

  const handleRequest = (request: IncomingMessage, response: ServerResponse): void => {
    void dispatch(request, response).catch((error: unknown) => {
      logger.warn(formatCompact({
        op: 'http_dispatch_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      if (!response.headersSent) {
        response.writeHead(500);
        response.end();
      } else {
        response.destroy();
      }
    });
  };
  const server: HttpServer | HttpsServer = secure
    ? createHttpsServer(options.tls as HttpsServerOptions, handleRequest)
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

  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (closed) {
      response.writeHead(503);
      response.end();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const abort = new AbortController();
    response.once('close', () => {
      if (!response.writableFinished) abort.abort(new Error('Client disconnected'));
    });
    let webRequest: Request;
    try {
      webRequest = createNodeRequest(request, { url, signal: abort.signal });
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const webResponse = await router.handle(webRequest, {
      ...(request.socket?.remoteAddress ? { remoteAddress: request.socket.remoteAddress } : {}),
    });
    await writeNodeResponse(response, webResponse);
  }

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (closed) {
      socket.destroy();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const remoteAddress = request.socket?.remoteAddress;
    void router.upgrade({
      url,
      headers: nodeRequestHeaders(request),
      ...(remoteAddress ? { remoteAddress } : {}),
    }).then((decision) => {
      if (!decision.accepted) {
        if (decision.status === 401 && !socket.destroyed) socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (closed || socket.destroyed) {
        decision.reject();
        if (!socket.destroyed) socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      let accepted = false;
      socket.once('close', () => { if (!accepted) decision.reject(); });
      try {
        wss.handleUpgrade(request, socket, head, (ws) => {
          accepted = true;
          decision.accept(wrapNodeWebSocket(ws));
        });
      } catch (err) {
        decision.reject();
        logger.warn(formatCompact({
          op: 'ws_upgrade_failed',
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
        }));
        try {
          socket.destroy();
        } catch {
          /* already destroyed */
        }
      }
    }, () => socket.destroy());
  });

  const runtime: ProcessHttpHost = {
    [generationAdmissionBinder]: (admission) => router[generationAdmissionBinder](admission),
    ws: (pathname, wsOptions) => router.ws(pathname, wsOptions),
    route: (method, path, handler, meta) => router.route(method, path, handler, meta),
    listRoutes: () => router.listRoutes(),
    get address() {
      return address;
    },
    get tokenRegistry() {
      return tokenRegistry;
    },

    listen(): Promise<HttpHostAddress> {
      if (closed) return Promise.reject(new Error('HTTP Host is closed'));
      if (listenResult) return listenResult;
      if (address) return Promise.resolve(address);
      listenResult = new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
          listenResult = undefined;
          reject(error);
        };
        server.once('error', onError);
        server.listen({ host, port }, () => {
          server.off('error', onError);
          if (closed) {
            reject(new Error('HTTP Host closed before listen completed'));
            return;
          }
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
            + ` | routes: ${router.routeCount}`
            + ` | token: ${tokenRegistry.hasAnyToken()
              ? tokenRegistry.primaryTokenPrefixForLog()
              : '(none)'}`,
          );
          logger.debug(
            `listen detail | cors: ${router.corsOrigins.join(',')}`
            + ` | ws: ${router.wsPaths.join(',') || '(none)'}`,
          );
          resolve(address);
        });
      });
      return listenResult;
    },

    close(): Promise<void> {
      if (closeResult) return closeResult;
      closed = true;
      router.close();
      closeResult = (async () => {
        // A pending listen must settle before deciding whether there is a
        // listener to close. Otherwise it can bind after close has resolved.
        await listenResult?.catch(() => undefined);
        if (!server.listening) {
          address = undefined;
          return;
        }
        await new Promise<void>((resolve, reject) => {
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
      })();
      return closeResult;
    },
  };
  return runtime;
}
