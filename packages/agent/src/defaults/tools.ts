/**
 * Default common tools — registered for all agents.
 *
 * These are the baseline tools every agent has access to.
 * Re-uses existing built-in tools from tools.ts.
 */

import type { AgentOrchestrator } from '../orchestrator/index.js';
import { getAllBuiltinTools } from '../tools.js';

export function registerDefaultTools(orchestrator: AgentOrchestrator): void {
  const builtinTools = getAllBuiltinTools();
  for (const tool of builtinTools) {
    orchestrator.addTool(tool, undefined, 'builtin');
  }
}
