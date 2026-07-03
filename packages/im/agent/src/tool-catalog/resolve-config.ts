import type { ZhinAgentConfig } from '../zhin-agent/config.js';
import {
  DEFAULT_DEFERRED_TOOLS_CONFIG,
  type DeferredToolsConfig,
} from './types.js';

export function resolveDeferredToolsConfig(
  config: Pick<ZhinAgentConfig, 'deferredTools' | 'orchestratorTools'>,
): Required<Pick<DeferredToolsConfig, 'maxLoadedPerSession' | 'discoverTopK' | 'alwaysLoadedTools'>> & {
  mcpServers: NonNullable<DeferredToolsConfig['mcpServers']>;
} {
  const dt = config.deferredTools ?? {};
  const legacy = config.orchestratorTools;
  const alwaysLoaded = dt.alwaysLoadedTools
    ?? (legacy?.length ? legacy : DEFAULT_DEFERRED_TOOLS_CONFIG.alwaysLoadedTools);
  return {
    maxLoadedPerSession: dt.maxLoadedPerSession ?? DEFAULT_DEFERRED_TOOLS_CONFIG.maxLoadedPerSession,
    discoverTopK: dt.discoverTopK ?? DEFAULT_DEFERRED_TOOLS_CONFIG.discoverTopK,
    alwaysLoadedTools: [...alwaysLoaded],
    mcpServers: dt.mcpServers ?? {},
  };
}

export function resolveAlwaysLoadedSet(
  config: Pick<ZhinAgentConfig, 'deferredTools' | 'orchestratorTools'>,
): Set<string> {
  return new Set(resolveDeferredToolsConfig(config).alwaysLoadedTools);
}

export function isMcpToolDeferred(
  toolName: string,
  mcpServer: string | undefined,
  deferredConfig: ReturnType<typeof resolveDeferredToolsConfig>,
): boolean {
  if (!mcpServer) return true;
  const serverCfg = deferredConfig.mcpServers[mcpServer];
  const always = new Set(serverCfg?.alwaysLoaded ?? []);
  return !always.has(toolName);
}
