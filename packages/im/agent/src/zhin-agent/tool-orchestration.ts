import type { AgentTool } from '@zhin.js/ai';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

/**
 * ADR 0024: tools are now directly available; role-based filtering
 * happens via RoleCapabilityPolicy at the pipeline level.
 */
export function resolveAgentToolsForTurn(
  _agent: ZhinAgentPrivate,
  allTools: AgentTool[],
): { tools: AgentTool[]; deferredStats?: string } {
  return { tools: allTools };
}
