/**
 * The gateway's view of the instance's HTTP surface (ADR 0054 §2 / §3).
 *
 * Structural copy of the transport interface the bridge wire protocol
 * (`@zhin.js/host-http/bridge`) provides; the gateway HTTP server only codes against this shape
 * so the in-memory test transport and the IPC transport are interchangeable.
 */
import type { ConsolePrincipal, WsConnection } from '@zhin.js/host-http';

/** One HTTP route the instance registered. `path` ends with `/*` for prefix routes. */
export interface InstanceHttpRoute {
  readonly method: string;
  readonly path: string;
}

/** One WebSocket route the instance registered. */
export interface InstanceWsRoute {
  readonly path: string;
  /** `host`: the gateway authenticates the upgrade; `protocol`: forwarded as-is. Default `host`. */
  readonly auth?: 'host' | 'protocol';
}

/** Route table announced by the instance in `ready` / `routes`. */
export interface RouteTable {
  readonly http: readonly InstanceHttpRoute[];
  readonly ws: readonly InstanceWsRoute[];
}

/** Per-request data the gateway resolved before forwarding. */
export interface InstanceRequestContext {
  /** Set for `{base}` routes (and public routes that presented a valid credential). */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

/** Upgrade data forwarded with a WebSocket. */
export interface InstanceWsOpenInfo extends InstanceRequestContext {
  readonly url: URL;
  readonly headers: Headers;
}

export interface InstanceTransport {
  /** The instance is connected and accepts requests. */
  readonly ready: boolean;
  routes(): RouteTable;
  /** Called when the instance announces a new route table; returns an unsubscriber. */
  onRoutes(listener: (routes: RouteTable) => void): () => void;
  /**
   * Forwards one request. The response body streams (SSE) with backpressure; aborting
   * `request.signal` (client disconnect) or cancelling the response body aborts it.
   */
  fetch(request: Request, context: InstanceRequestContext): Promise<Response>;
  /**
   * Bridges an accepted client socket to the instance's WebSocket route. Resolves false when
   * the instance refused or is unavailable; the caller then closes `peer`.
   */
  openWebSocket(info: InstanceWsOpenInfo, peer: WsConnection): Promise<boolean>;
}

export const EMPTY_ROUTE_TABLE: RouteTable = Object.freeze({
  http: Object.freeze([]) as readonly InstanceHttpRoute[],
  ws: Object.freeze([]) as readonly InstanceWsRoute[],
});
