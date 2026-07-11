/**
 * Shared runtime deps for qq agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { QQAdapter } from './adapter.js';
import type { QQEndpoint } from './endpoint.js';
import type { ReceiverMode } from './types.js';

export interface QqAgentDeps {
  getEndpoint: (endpointId: string) => QQEndpoint<ReceiverMode>;
  getAdapter: () => QQAdapter;
}

let _deps: QqAgentDeps | null = null;

export function setQqAgentDeps(deps: QqAgentDeps): void {
  _deps = deps;
}

export function getQqAgentDeps(): QqAgentDeps {
  if (!_deps) throw new Error('qq agent deps not initialized');
  return _deps;
}
