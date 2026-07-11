import type { LarkAdapter } from './adapter.js';
import type { LarkEndpoint } from './endpoint.js';

export interface LarkAgentDeps {
  getEndpoint: (endpointId: string) => LarkEndpoint;
  getAdapter: () => LarkAdapter;
}

let _deps: LarkAgentDeps | null = null;

export function setLarkAgentDeps(deps: LarkAgentDeps): void {
  _deps = deps;
}

export function getLarkAgentDeps(): LarkAgentDeps {
  if (!_deps) throw new Error('lark agent deps not initialized');
  return _deps;
}
