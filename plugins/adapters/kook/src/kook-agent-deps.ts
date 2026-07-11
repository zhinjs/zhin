/**
 * Shared runtime deps for kook agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { KookAdapter } from './adapter.js';
import type { KookEndpoint } from './endpoint.js';

export interface KookAgentDeps {
  getEndpoint: (endpointId: string) => KookEndpoint;
  getAdapter: () => KookAdapter;
}

let _deps: KookAgentDeps | null = null;

export function setKookAgentDeps(deps: KookAgentDeps): void {
  _deps = deps;
}

export function getKookAgentDeps(): KookAgentDeps {
  if (!_deps) throw new Error('kook agent deps not initialized');
  return _deps;
}
