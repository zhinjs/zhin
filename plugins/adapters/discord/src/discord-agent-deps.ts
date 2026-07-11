/**
 * Shared runtime deps for discord agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { DiscordAdapter, DiscordEndpointLike } from './adapter.js';

export interface DiscordAgentDeps {
  getEndpoint: (endpointId: string) => DiscordEndpointLike;
  getGatewayEndpoint: (endpointId: string) => DiscordEndpointLike;
  getAdapter: () => DiscordAdapter;
}

let _deps: DiscordAgentDeps | null = null;

export function setDiscordAgentDeps(deps: DiscordAgentDeps): void {
  _deps = deps;
}

export function getDiscordAgentDeps(): DiscordAgentDeps {
  if (!_deps) throw new Error('discord agent deps not initialized');
  return _deps;
}
