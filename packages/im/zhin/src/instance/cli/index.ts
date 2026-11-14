/**
 * `zhin.js/instance/cli` — IM-backed helpers that `@zhin.js/cli` resolves from the project's
 * `zhin.js` at run time (the CLI does not depend on IM layers, ADR 0054 §0).
 * Temporary: `zhin console *` moves to the gateway's own database access in B1.4.
 * @module zhin.js/instance/cli
 */
export { createDatabaseHost, renderToSegments, resolveDatabaseConfig } from '@zhin.js/core/runtime';
export { parseComponentDefinition } from '@zhin.js/component';
export {
  describeEngagement,
  formatEngagementCollaborationGraph,
  formatEngagementList,
  openProjectEngagementJournal,
} from './trace.js';

/** `zhin usage report`: service names for recorded provider ids (#1250). */
export { loadProviderDisplay } from './provider-display.js';

/** `zhin agent info`; `@zhin.js/agent` is an optional peer of `zhin.js`. */
export function loadAgentModule(): Promise<typeof import('@zhin.js/agent')> {
  return import('@zhin.js/agent');
}

/** `zhin trace`. */
export function loadAgentTraceModule(): Promise<typeof import('@zhin.js/agent/trace')> {
  return import('@zhin.js/agent/trace');
}

/** `zhin migrate inference` (Session binding previews / apply). */
export function loadInferenceMigrationSessionBindings(): Promise<typeof import('../inference/migration-session-bindings.js')> {
  return import('../inference/migration-session-bindings.js');
}

/** `zhin migrate inference` (read-only source preview). */
export function loadInferenceMigrationPreview(): Promise<typeof import('../inference/migration-preview.js')> {
  return import('../inference/migration-preview.js');
}

/** `zhin migrate inference --apply / --finalize`. */
export function loadInferenceMigrationApply(): Promise<typeof import('../inference/migration-apply.js')> {
  return import('../inference/migration-apply.js');
}
