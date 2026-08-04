/**
 * Runtime-first public API for the A2A Host.
 *
 * A2A routes are installed by the CLI composition root. Importing this package
 * is intentionally inert and cannot depend on the removed legacy router.
 */
export {
  installRuntimeA2a,
  type InstallRuntimeA2aOptions,
  type RuntimeA2aConfig,
} from './runtime.js';
export type { RuntimeA2aConfig as A2aConfig } from './runtime.js';
export { verifyA2aBearer } from './auth.js';
