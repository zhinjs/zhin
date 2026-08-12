/**
 * Agent tool deps for dingtalk (user / dept / chat / work notice).
 * Endpoints register themselves on start; tools look up by endpoint id.
 */

export interface DingtalkAgentEndpoint {
  getUserInfo(userId: string): Promise<unknown>;
  getDepartmentUsers(deptId: number): Promise<unknown[]>;
  sendWorkNotice(userIdList: string[], content: unknown): Promise<boolean>;
  getDepartmentList(deptId?: number): Promise<unknown[]>;
  getDepartmentInfo(deptId: number): Promise<unknown>;
  createChat(name: string, ownerUserId: string, userIdList: string[]): Promise<string | null>;
  getChatInfo(chatId: string): Promise<unknown>;
  updateChat(
    chatId: string,
    options: {
      name?: string;
      owner?: string;
      add_useridlist?: string[];
      del_useridlist?: string[];
    },
  ): Promise<boolean>;
}

export interface DingtalkAgentDeps {
  getEndpoint: (endpointKey: string) => DingtalkAgentEndpoint;
}

const endpoints = new Map<string, DingtalkAgentEndpoint>();
let override: DingtalkAgentDeps | null = null;

export function registerDingtalkAgentEndpoint(
  endpointKey: string,
  endpoint: DingtalkAgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setDingtalkAgentDeps(deps: DingtalkAgentDeps | null): void {
  override = deps;
}

export function getDingtalkAgentDeps(): DingtalkAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointKey) {
      const endpoint = endpoints.get(endpointKey);
      if (!endpoint) throw new Error(`Endpoint ${endpointKey} 不存在`);
      return endpoint;
    },
  };
}
