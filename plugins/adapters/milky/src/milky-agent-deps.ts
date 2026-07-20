/**
 * Agent tool deps for milky (scene management / callApi).
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface MilkyAgentEndpoint {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
  kickMember(groupId: number, userId: number, rejectAddRequest?: boolean): Promise<boolean>;
  muteMember(groupId: number, userId: number, duration?: number): Promise<boolean>;
  muteAll(groupId: number, enable?: boolean): Promise<boolean>;
  setAdmin(groupId: number, userId: number, enable?: boolean): Promise<boolean>;
  setCard(groupId: number, userId: number, card: string): Promise<boolean>;
  setTitle(groupId: number, userId: number, title: string): Promise<boolean>;
  setGroupName(groupId: number, name: string): Promise<boolean>;
  getMemberList(groupId: number): Promise<unknown[]>;
  getGroupInfo(groupId: number): Promise<unknown>;
  recallMessage?(id: string): Promise<void>;
}

export interface MilkyAgentDeps {
  getEndpoint: (endpointId: string) => MilkyAgentEndpoint;
}

const endpoints = new Map<string, MilkyAgentEndpoint>();
let override: MilkyAgentDeps | null = null;

export function registerMilkyAgentEndpoint(
  endpointId: string,
  endpoint: MilkyAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setMilkyAgentDeps(deps: MilkyAgentDeps | null): void {
  override = deps;
}

export function getMilkyAgentDeps(): MilkyAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId: string): MilkyAgentEndpoint {
      const registered = endpoints.get(endpointId);
      if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
      return registered;
    },
  };
}
