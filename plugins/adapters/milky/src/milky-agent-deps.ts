import type { MilkyAdapter, MilkyBot } from './adapter.js';

export interface MilkyAgentDeps {
  getEndpoint: (endpointId: string) => MilkyBot;
  getAdapter: () => MilkyAdapter;
}

let _deps: MilkyAgentDeps | null = null;

export function setMilkyAgentDeps(deps: MilkyAgentDeps): void {
  _deps = deps;
}

export function getMilkyAgentDeps(): MilkyAgentDeps {
  if (!_deps) throw new Error('milky agent deps not initialized');
  return _deps;
}
