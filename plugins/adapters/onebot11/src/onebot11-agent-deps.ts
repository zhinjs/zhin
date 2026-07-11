import type { OneBot11Adapter, OneBot11Bot } from './adapter.js';

export interface Onebot11AgentDeps {
  getEndpoint: (endpointId: string) => OneBot11Bot;
  getAdapter: () => OneBot11Adapter;
}

let _deps: Onebot11AgentDeps | null = null;

export function setOnebot11AgentDeps(deps: Onebot11AgentDeps): void {
  _deps = deps;
}

export function getOnebot11AgentDeps(): Onebot11AgentDeps {
  if (!_deps) throw new Error('onebot11 agent deps not initialized');
  return _deps;
}
