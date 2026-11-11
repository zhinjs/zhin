/**
 * `@zhin.js/gateway/http` — the gateway HTTP server (ADR 0054 §2 / §3), its composition with the
 * instance supervisor, and HTML / SSE response helpers shared by gateway and instance routes
 * (JSON: `jsonResponse` from `@zhin.js/host-http`).
 */
export * from './http-response.js';
export * from './http/instance-transport.js';
export * from './http/gateway-http-server.js';
export * from './http/start-gateway.js';
