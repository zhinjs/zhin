/**
 * ADR 0030 — tiered tool execution bucket SSOT.
 * Parallel-safe tools may run concurrently within one assistant turn.
 */

export const TIERED_PARALLEL_TOOL_NAMES = new Set([
  'read_file',
  'grep',
  'glob',
  'list_dir',
  'web_search',
  'web_fetch',
  'todo_read',
  'discover',
  'load_tool',
  'load_skill',
  'user_profile',
  'knowledge_search',
  'memory_search',
  // #1250: the collaboration `delegate` waits up to 20 s for its result. Several delegates of one step
  // are sent together and waited for together, so the step takes as long as the slowest, not the sum.
  'delegate',
]);

export function isTieredParallelTool(toolName: string): boolean {
  if (TIERED_PARALLEL_TOOL_NAMES.has(toolName)) return true;
  if (toolName.startsWith('mcp_') && toolName.includes('read')) return true;
  return false;
}
