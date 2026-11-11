/**
 * `zhin.js/instance` — the Zhin instance composition root (ADR 0054 §0): IM Runtime, plugins,
 * adapters, Agent and the runtime-side Console backend. Moved from `@zhin.js/cli`.
 *
 * Until B1.1 the CLI still starts it in-process (`zhin runtime start` child); from B1.2 only the
 * gateway launches it.
 * @module zhin.js/instance
 */
export * from './root-host.js';
export * from './start-command.js';
