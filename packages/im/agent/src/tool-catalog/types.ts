import type { AgentTool } from '@zhin.js/ai';

export type ToolCatalogSource = 'builtin' | 'plugin' | 'mcp' | 'skill' | 'meta';

export interface ToolCatalogItem {
  name: string;
  brief: string;
  fullTool: AgentTool;
  source: ToolCatalogSource;
  mcpServer?: string;
  deferDefault: boolean;
}

export type DiscoverKind = 'tool' | 'skill' | 'all';

export interface DiscoverResultItem {
  kind: 'tool' | 'skill';
  name: string;
  brief: string;
  score: number;
}

export interface DeferredToolsConfig {
  maxLoadedPerSession?: number;
  discoverTopK?: number;
  alwaysLoadedTools?: string[];
  mcpServers?: Record<string, { alwaysLoaded?: string[] }>;
}

export const DEFAULT_ALWAYS_LOADED_TOOLS = [
  'ask_user',
  'spawn_task',
  'discover',
  'load_tool',
  'load_skill',
] as const;

export const DEFAULT_DEFERRED_TOOLS_CONFIG: Required<Pick<DeferredToolsConfig, 'maxLoadedPerSession' | 'discoverTopK' | 'alwaysLoadedTools'>> = {
  maxLoadedPerSession: 12,
  discoverTopK: 5,
  alwaysLoadedTools: [...DEFAULT_ALWAYS_LOADED_TOOLS],
};

export const DEFERRED_META_TOOL_NAMES = new Set([
  'discover',
  'load_tool',
  'load_skill',
]);
