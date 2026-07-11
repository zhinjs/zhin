/**
 * Shared runtime deps for slack agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { SlackAdapter } from './adapter.js';
import type { SlackEndpoint } from './endpoint.js';

export interface SlackAgentDeps {
  getEndpoint: (endpointId: string) => SlackEndpoint;
  getAdapter: () => SlackAdapter;
}

let _deps: SlackAgentDeps | null = null;

export function setSlackAgentDeps(deps: SlackAgentDeps): void {
  _deps = deps;
}

export function getSlackAgentDeps(): SlackAgentDeps {
  if (!_deps) throw new Error('slack agent deps not initialized');
  return _deps;
}
