/**
 * One Node `http` / `https` listener that feeds a transport-independent request handler and
 * WebSocket upgrade handler (ADR 0054 §2). The in-process Host and the management gateway
 * both run on it.
 */
import {
  createServer as createHttpServer,
  STATUS_CODES,
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
import type { HttpRequestInfo, WsUpgradeDecision, WsUpgradeRequest } from '../http-host.js';
import type { HttpHostAddress, HttpHostTlsOptions } from '../host-options.js';
import { DEFAULT_HTTP_PORT } from '../port.js';
import { compileTrustProxy, resolveClientAddress, type TrustProxySetting } from '../trust-proxy.js';
import { createNodeRequest, nodeRequestHeaders, writeNodeResponse, wrapNodeWebSocket } from './node-http.js';

const logger = getLogger('http');

export interface NodeHttpListenerOptions {
  readonly host?: string;
  readonly port?: number;
  /** Enables HTTPS / WSS on this listener. */
  readonly tls?: HttpHostTlsOptions;
  /** `http.trustProxy`: derive `remoteAddress` from forwarding headers sent by trusted peers. */
  readonly trustProxy?: TrustProxySetting;
  handle(request: Request, info: HttpRequestInfo): Promise<Response>;
  upgrade(request: WsUpgradeRequest): Promise<WsUpgradeDecision>;
  /** Called once the listener is bound, before `listen()` resolves. */
  onListening?(address: HttpHostAddress): void;
  /** Called after the listener closed. */
  onClosed?(): void;
}

export interface NodeHttpListener {
  listen(): Promise<HttpHostAddress>;
  /** Destroys open connections (SSE, keep-alive, WebSocket) and stops listening. */
  close(): Promise<void>;
  readonly address: HttpHostAddress | undefined;
  readonly secure: boolean;
}

/** A Node listener over {@link NodeHttpListenerOptions.handle} / `upgrade`. */
export function createNodeHttpListener(options: NodeHttpListenerOptions): NodeHttpListener {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? DEFAULT_HTTP_PORT;
  const secure = options.tls !== undefined;
  let address: HttpHostAddress | undefined;
  let closed = false;
  let closeResult: Promise<void> | undefined;
  let listenResult: Promise<HttpHostAddress> | undefined;
  const trust = compileTrustProxy(options.trustProxy);
  const clientAddress = (request: IncomingMessage): string | undefined =>
    resolveClientAddress(request.socket?.remoteAddress, request.headers, trust);

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
  // (SSE, keep-alive) that would otherwise block server.close().
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
    const remoteAddress = clientAddress(request);
    const webResponse = await options.handle(webRequest, {
      ...(remoteAddress ? { remoteAddress } : {}),
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
    const remoteAddress = clientAddress(request);
    void options.upgrade({
      url,
      headers: nodeRequestHeaders(request),
      ...(remoteAddress ? { remoteAddress } : {}),
    }).then((decision) => {
      if (!decision.accepted) {
        if (decision.status !== 404) writeUpgradeRefusal(socket, decision.status, decision.headers);
        socket.destroy();
        return;
      }
      if (closed || socket.destroyed) {
        decision.reject();
        writeUpgradeRefusal(socket, 401);
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

  return {
    get address() { return address; },
    secure,
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
          options.onListening?.(address);
          resolve(address);
        });
      });
      return listenResult;
    },
    close(): Promise<void> {
      if (closeResult) return closeResult;
      closed = true;
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
              address = undefined;
              options.onClosed?.();
              resolve();
            });
          });
        });
      })();
      return closeResult;
    },
  };
}

function writeUpgradeRefusal(
  socket: Duplex,
  status: number,
  headers?: Readonly<Record<string, string>>,
): void {
  if (socket.destroyed) return;
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}`.trimEnd()];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name) && !/[\r\n]/u.test(value)) lines.push(`${name}: ${value}`);
  }
  socket.write(`${lines.join('\r\n')}\r\n\r\n`);
}
