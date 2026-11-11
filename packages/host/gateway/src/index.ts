/**
 * Zhin.js management gateway (ADR 0054). It must not import `zhin.js` or any IM layer.
 *
 * Until the gateway process exists (B1.1–B1.4) this package is a library: the Zhin instance
 * (`zhin.js/instance`) still installs Console access control and the terminal into its in-process
 * HTTP host, and both the instance and `@zhin.js/cli` share the project-file services below.
 * Import the narrow subpaths (`@zhin.js/gateway/<area>`) to avoid loading unrelated areas.
 * @module @zhin.js/gateway
 */
export * from './iam.js';
export * from './terminal.js';
export * from './config.js';
export * from './plugin-management.js';
export * from './project.js';
export * from './supervisor.js';
export * from './usage.js';
export * from './onboarding.js';
export * from './http.js';
export * from './packages.js';
