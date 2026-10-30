import type { AgentTool } from '@zhin.js/ai';

export type ToolCatalogSource = 'builtin' | 'plugin' | 'mcp' | 'skill' | 'meta';

export interface ToolCatalogItem {
  name: string;
  brief: string;
  fullTool: AgentTool;
  source: ToolCatalogSource;
  /** Canonical owning plugin; `fullTool.source` remains the diagnostic entry path. */
  owner?: string;
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
  /** Extra always-loaded tools. Added to the defaults unless `alwaysLoadedMode` is `replace`. */
  alwaysLoadedTools?: string[];
  /**
   * `extend` (default): `alwaysLoadedTools` is added to the default resident set.
   * `replace`: `alwaysLoadedTools` is the complete resident set (opt-out of the defaults).
   */
  alwaysLoadedMode?: 'extend' | 'replace';
  mcpServers?: Record<string, { alwaysLoaded?: string[] }>;
}

/**
 * Workspace file tools the model reaches for without discovery. Keeping them
 * loaded avoids `Unknown tool` round trips. They are still only exposed when
 * the turn's tool filters and exec policy allow them. `bash` stays deferred
 * because its availability depends on the turn's shell isolation policy.
 */
export const CORE_WORKSPACE_TOOLS = [
  'read_file',
  'list_dir',
  'glob',
  'grep',
  'edit_file',
  'write_file',
] as const;

export const DEFAULT_ALWAYS_LOADED_TOOLS = [
  'ask_user',
  'spawn_task',
  'discover',
  'load_tool',
  'load_skill',
  ...CORE_WORKSPACE_TOOLS,
] as const;

/**
 * Scene tiers for the resident tool set (ADR 0042 §2).
 * - `chat`: group / channel chats and ordinary private chats. Chat essentials only.
 * - `master`: private chat with a master. Chat essentials plus development tools.
 * - `full`: no scene tier (scheduled / detached / sub-agent turns): the whole default set.
 */
export type ToolTier = 'chat' | 'master' | 'full';

/** Chat essentials: reply helpers, memory lookup, conversation info and the discovery meta tools. */
export const CHAT_ESSENTIAL_TOOLS = [
  'discover',
  'load_tool',
  'load_skill',
  'pick_sticker',
  'memory_search',
  'conversation_info',
] as const;

/**
 * Development and delegation tools, resident only for a master's private chat
 * (`bash` still obeys the turn's shell policy).
 */
export const MASTER_DEV_TOOLS = ['ask_user', 'spawn_task', ...CORE_WORKSPACE_TOOLS, 'bash'] as const;

const TIER_RESIDENT_TOOLS: Record<ToolTier, readonly string[]> = {
  chat: CHAT_ESSENTIAL_TOOLS,
  master: [...CHAT_ESSENTIAL_TOOLS, ...MASTER_DEV_TOOLS],
  full: DEFAULT_ALWAYS_LOADED_TOOLS,
};

/** Default resident tool names for a scene tier, before `alwaysLoadedTools` is applied on top. */
export function tierResidentTools(tier: ToolTier = 'full'): readonly string[] {
  return TIER_RESIDENT_TOOLS[tier];
}

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
