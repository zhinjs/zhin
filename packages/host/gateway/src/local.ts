/**
 * `@zhin.js/gateway/local` — the gateway's local control socket (ADR 0054 §6): paths, the
 * JSON-lines protocol, the server, the CLI client and `.zhin/gateway.json`. No Node HTTP stack.
 */
export * from './local/paths.js';
export * from './local/protocol.js';
export * from './local/local-socket.js';
export * from './local/handler.js';
export * from './local/client.js';
export * from './local/state-file.js';
