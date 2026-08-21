/**
 * Default common hooks — baseline AI lifecycle hooks.
 */

import type { AgentResourceHub } from '../resource-hub/index.js';

export function registerDefaultHooks(_resourceHub: AgentResourceHub): void {
  // Default hooks are intentionally minimal.
  // The existing hooks.ts module-level API handles legacy hooks.
  // Plugins/users register hooks via resourceHub.addHook().
}
