/**
 * Agent tool deps for wecom (get_user / departments / send_text).
 * Endpoints register themselves on start; tools look up by endpoint id.
 */

export interface WecomAgentEndpoint {
  getUserInfo(userId: string): Promise<unknown>;
  getDepartmentUsers(deptId: number): Promise<unknown[]>;
  getDepartmentList(deptId?: number): Promise<unknown[]>;
  sendTextMessage(userId: string, content: string): Promise<boolean>;
}

export interface WecomAgentDeps {
  getEndpoint: (endpointKey: string) => WecomAgentEndpoint;
}

const endpoints = new Map<string, WecomAgentEndpoint>();
let override: WecomAgentDeps | null = null;

export function registerWecomAgentEndpoint(
  endpointKey: string,
  endpoint: WecomAgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setWecomAgentDeps(deps: WecomAgentDeps | null): void {
  override = deps;
}

export function getWecomAgentDeps(): WecomAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointKey) {
      const endpoint = endpoints.get(endpointKey);
      if (!endpoint) throw new Error(`Endpoint ${endpointKey} 不存在`);
      return endpoint;
    },
  };
}
