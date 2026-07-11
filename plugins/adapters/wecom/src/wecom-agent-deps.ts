import type { WecomAdapter } from './adapter.js';
import type { WecomEndpoint } from './endpoint.js';

export interface WecomAgentDeps {
  getEndpoint: (endpointId: string) => WecomEndpoint;
  getAdapter: () => WecomAdapter;
}

let _deps: WecomAgentDeps | null = null;

export function setWecomAgentDeps(deps: WecomAgentDeps): void {
  _deps = deps;
}

export function getWecomAgentDeps(): WecomAgentDeps {
  if (!_deps) throw new Error('wecom agent deps not initialized');
  return _deps;
}
