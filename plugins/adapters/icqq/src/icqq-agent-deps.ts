import type { IcqqAdapter } from './adapter.js';
import type { IcqqEndpoint } from './endpoint.js';

export interface IcqqAgentDeps {
  getEndpoint: (endpointId: string) => IcqqEndpoint;
  getAdapter: () => IcqqAdapter;
}

let _deps: IcqqAgentDeps | null = null;

export function setIcqqAgentDeps(deps: IcqqAgentDeps): void {
  _deps = deps;
}

export function getIcqqAgentDeps(): IcqqAgentDeps {
  if (!_deps) throw new Error('icqq agent deps not initialized');
  return _deps;
}
