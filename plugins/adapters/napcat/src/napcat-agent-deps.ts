/**
 * Shared runtime deps for napcat agent/ authoring tools.
 */
import type { NapCatAdapter, NapCatEndpoint } from './adapter.js';

export interface NapcatAgentDeps {
  getAdapter: () => NapCatAdapter;
}

let _deps: NapcatAgentDeps | null = null;

export function setNapcatAgentDeps(deps: NapcatAgentDeps): void {
  _deps = deps;
}

export function getNapcatAgentDeps(): NapcatAgentDeps {
  if (!_deps) throw new Error('napcat agent deps not initialized');
  return _deps;
}

export function getAdapter(): NapCatAdapter {
  return getNapcatAgentDeps().getAdapter();
}

export function getEndpoint(endpointId: string): NapCatEndpoint {
  const endpoint = getAdapter().endpoints.get(endpointId);
  if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
  return endpoint;
}
