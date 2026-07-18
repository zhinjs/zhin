/**
 * Agent tool deps for kook.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface KookAgentEndpoint {
  getRoleList(guildId: string): Promise<Array<{
    role_id: string | number;
    name: string;
    color?: number;
    position?: number;
    permissions?: unknown;
  }>>;
  createRole(guildId: string, name: string): Promise<{ role_id: string | number; name: string }>;
  deleteRole(guildId: string, roleId: string): Promise<boolean>;
  grantRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  revokeRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  addToBlacklist(guildId: string, userId: string, remark?: string): Promise<boolean>;
  removeFromBlacklist(guildId: string, userId: string): Promise<boolean>;
}

export interface KookAgentDeps {
  getEndpoint: (endpointId: string) => KookAgentEndpoint;
}

const endpoints = new Map<string, KookAgentEndpoint>();
let override: KookAgentDeps | null = null;

export function registerKookAgentEndpoint(
  endpointId: string,
  endpoint: KookAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setKookAgentDeps(deps: KookAgentDeps | null): void {
  override = deps;
}

export function getKookAgentDeps(): KookAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId: string): KookAgentEndpoint {
      const registered = endpoints.get(endpointId);
      if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
      return registered;
    },
  };
}
