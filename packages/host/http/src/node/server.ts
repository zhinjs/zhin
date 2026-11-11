import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  generationAdmissionBinder,
  type GenerationAdmissionBindable,
} from '@zhin.js/plugin-runtime';
import { createHttpRouter, type HttpHost } from '../http-host.js';
import type { HttpHostAddress, HttpHostOptions } from '../host-options.js';
import { createNodeHttpListener } from './listener.js';

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
  const secure = options.tls !== undefined;
  let closeResult: Promise<void> | undefined;

  const router = createHttpRouter({
    token: options.token,
    corsOrigins: options.corsOrigins,
    apiBase: options.apiBase,
    authExemptPaths: options.authExemptPaths,
    tokenRegistry: options.tokenRegistry,
    secure,
    address: () => listener.address,
  });
  const tokenRegistry = router.tokenRegistry;

  const listener = createNodeHttpListener({
    host: options.host,
    port: options.port,
    tls: options.tls,
    handle: (request, info) => router.handle(request, info),
    upgrade: (request) => router.upgrade(request),
    onListening(address) {
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
    },
    onClosed() {
      logger.debug(formatCompact({ op: 'http_host_closed' }));
    },
  });

  const runtime: ProcessHttpHost = {
    [generationAdmissionBinder]: (admission) => router[generationAdmissionBinder](admission),
    ws: (pathname, wsOptions) => router.ws(pathname, wsOptions),
    route: (method, path, handler, meta) => router.route(method, path, handler, meta),
    listRoutes: () => router.listRoutes(),
    get address() {
      return listener.address;
    },
    get tokenRegistry() {
      return tokenRegistry;
    },
    listen: () => listener.listen(),
    close(): Promise<void> {
      if (closeResult) return closeResult;
      router.close();
      closeResult = listener.close();
      return closeResult;
    },
  };
  return runtime;
}
