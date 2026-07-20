/**
 * Agent tool deps for line (get_profile / get_group_members).
 * Endpoints register themselves on start; tools look up the active API config.
 */

export interface LineAgentEndpoint {
  getApiConfig(): { accessToken: string; apiBaseUrl: string };
}

export interface LineAgentDeps {
  getApiConfig: () => { accessToken: string; apiBaseUrl: string };
}

const endpoints = new Map<string, LineAgentEndpoint>();
let override: LineAgentDeps | null = null;

export function registerLineAgentEndpoint(
  endpointId: string,
  endpoint: LineAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setLineAgentDeps(deps: LineAgentDeps | null): void {
  override = deps;
}

export function getLineAgentDeps(): LineAgentDeps {
  if (override) return override;
  return {
    getApiConfig() {
      const first = endpoints.values().next().value as LineAgentEndpoint | undefined;
      if (!first) throw new Error('LINE channel access token not configured');
      return first.getApiConfig();
    },
  };
}

export function getLineApiConfig(): { accessToken: string; apiBaseUrl: string } {
  return getLineAgentDeps().getApiConfig();
}
