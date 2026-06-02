/**
 * Default common hooks — baseline AI lifecycle hooks.
 */

import type { AgentOrchestrator } from '../orchestrator/index.js';

export function registerDefaultHooks(_orchestrator: AgentOrchestrator): void {
  // Default hooks are intentionally minimal.
  // The existing hooks.ts module-level API handles legacy hooks.
  // Plugins/users register hooks via orchestrator.addHook().
}
