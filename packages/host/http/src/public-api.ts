/**
 * Plugin-facing HTTP Host contract exposed from `@zhin.js/host-http`.
 * @module @zhin.js/host-http
 */
export {
  httpHostToken,
  type HttpHandler,
  type HttpHost,
  type HttpHostAddress,
  type HttpRouteRegistration,
  type RouteContext,
  type WsConnection,
  type WsHandle,
  type WsRouteOptions,
} from './http-host.js';
export type { AuthenticatedTokenPrincipal, AuthScope } from './token-registry.js';
export type { ListedRoute, OpenApiParameter, RouteMeta } from './openapi.js';
