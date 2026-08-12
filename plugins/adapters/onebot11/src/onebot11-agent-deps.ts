/**
 * Agent tool deps for onebot11 (set_title etc.).
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface Onebot11AgentEndpoint {
  setTitle(
    groupId: number,
    userId: number,
    title: string,
    duration?: number,
  ): Promise<boolean>;
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface Onebot11AgentDeps {
  getEndpoint: (endpointKey: string) => Onebot11AgentEndpoint;
}

const endpoints = new Map<string, Onebot11AgentEndpoint>();
let override: Onebot11AgentDeps | null = null;

export function registerOnebot11AgentEndpoint(
  endpointKey: string,
  endpoint: Onebot11AgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
    }
  };
}

/** Optional override used by tests / transitional callers. */
export function setOnebot11AgentDeps(deps: Onebot11AgentDeps): void {
  override = deps;
}

export function getOnebot11AgentDeps(): Onebot11AgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointKey: string): Onebot11AgentEndpoint {
      const registered = endpoints.get(endpointKey);
      if (!registered) throw new Error(`Endpoint ${endpointKey} 不存在`);
      return registered;
    },
  };
}
