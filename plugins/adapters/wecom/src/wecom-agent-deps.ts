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
  getEndpoint: (endpointId: string) => WecomAgentEndpoint;
}

const endpoints = new Map<string, WecomAgentEndpoint>();
let override: WecomAgentDeps | null = null;

export function registerWecomAgentEndpoint(
  endpointId: string,
  endpoint: WecomAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
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
    getEndpoint(endpointId) {
      const endpoint = endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
  };
}
