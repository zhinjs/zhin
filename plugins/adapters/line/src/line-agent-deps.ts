/**
 * Shared runtime deps for line agent/ authoring tools.
 */
import type { LineAdapter } from './adapter.js';
import type { LineEndpoint } from './endpoint.js';

export interface LineAgentDeps {
  getAdapter: () => LineAdapter;
}

let _deps: LineAgentDeps | null = null;

export function setLineAgentDeps(deps: LineAgentDeps): void {
  _deps = deps;
}

export function getLineAgentDeps(): LineAgentDeps {
  if (!_deps) throw new Error('line agent deps not initialized');
  return _deps;
}

export function getAdapter(): LineAdapter {
  return getLineAgentDeps().getAdapter();
}

export function getDefaultEndpoint(): LineEndpoint | undefined {
  return getAdapter().endpoints.values().next().value;
}

export function getLineApiConfig(): { accessToken: string; apiBaseUrl: string } {
  const endpoint = getDefaultEndpoint();
  const accessToken = endpoint?.$config?.channelAccessToken;
  if (!accessToken) throw new Error('LINE channel access token not configured');
  return {
    accessToken,
    apiBaseUrl: endpoint?.$config?.apiBaseUrl || 'https://api.line.me',
  };
}
