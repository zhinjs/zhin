/**
 * ADR 0030 — tiered tool execution bucket SSOT.
 * Parallel-safe tools may run concurrently within one assistant turn.
 */

export const TIERED_PARALLEL_TOOL_NAMES = new Set([
  'spawn_task',
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
  'chat_history',
  'user_profile',
  'knowledge_search',
  'memory_search',
]);

export function isTieredParallelTool(toolName: string): boolean {
  if (TIERED_PARALLEL_TOOL_NAMES.has(toolName)) return true;
  if (toolName.startsWith('mcp_') && toolName.includes('read')) return true;
  return false;
}
