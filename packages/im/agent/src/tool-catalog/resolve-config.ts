import type { ZhinAgentConfig } from '../config/index.js';
import {
  DEFAULT_DEFERRED_TOOLS_CONFIG,
  tierResidentTools,
  type DeferredToolsConfig,
  type ToolTier,
} from './types.js';

export function resolveDeferredToolsConfig(
  config: Pick<ZhinAgentConfig, 'deferredTools'>,
  tier: ToolTier = 'full',
): Required<Pick<DeferredToolsConfig, 'maxLoadedPerSession' | 'discoverTopK' | 'alwaysLoadedTools'>> & {
  mcpServers: NonNullable<DeferredToolsConfig['mcpServers']>;
} {
  const dt = config.deferredTools ?? {};
  // Configured tools extend the default resident set; `replace` is the explicit opt-out (#740).
  const configured = dt.alwaysLoadedTools ?? [];
  const alwaysLoaded = dt.alwaysLoadedMode === 'replace'
    ? configured
    : [...new Set([...tierResidentTools(tier), ...configured])];
  return {
    maxLoadedPerSession: dt.maxLoadedPerSession ?? DEFAULT_DEFERRED_TOOLS_CONFIG.maxLoadedPerSession,
    discoverTopK: dt.discoverTopK ?? DEFAULT_DEFERRED_TOOLS_CONFIG.discoverTopK,
    alwaysLoadedTools: [...alwaysLoaded],
    mcpServers: dt.mcpServers ?? {},
  };
}
