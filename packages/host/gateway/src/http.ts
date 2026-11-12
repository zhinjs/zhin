/**
 * `@zhin.js/gateway/http` — HTML / SSE response helpers shared by gateway and instance routes
 * (JSON: `jsonResponse` from `@zhin.js/host-http`). The instance imports this subpath, so it must
 * not load the Node HTTP stack; the gateway HTTP server is `@zhin.js/gateway/server`.
 */
export * from './http-response.js';
