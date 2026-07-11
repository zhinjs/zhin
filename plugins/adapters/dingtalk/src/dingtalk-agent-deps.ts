import type { DingTalkAdapter } from './adapter.js';
import type { DingTalkEndpoint } from './endpoint.js';

export interface DingtalkAgentDeps {
  getEndpoint: (endpointId: string) => DingTalkEndpoint;
  getAdapter: () => DingTalkAdapter;
}

let _deps: DingtalkAgentDeps | null = null;

export function setDingtalkAgentDeps(deps: DingtalkAgentDeps): void {
  _deps = deps;
}

export function getDingtalkAgentDeps(): DingtalkAgentDeps {
  if (!_deps) throw new Error('dingtalk agent deps not initialized');
  return _deps;
}
