/**
 * Shared runtime deps for telegram agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { TelegramAdapter } from './adapter.js';
import type { TelegramEndpoint } from './endpoint.js';

export interface TelegramAgentDeps {
  getEndpoint: (endpointId: string) => TelegramEndpoint;
  getAdapter: () => TelegramAdapter;
}

let _deps: TelegramAgentDeps | null = null;

export function setTelegramAgentDeps(deps: TelegramAgentDeps): void {
  _deps = deps;
}

export function getTelegramAgentDeps(): TelegramAgentDeps {
  if (!_deps) throw new Error('telegram agent deps not initialized');
  return _deps;
}
