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
  getEndpoint: (endpointKey: string) => KookAgentEndpoint;
}

const endpoints = new Map<string, KookAgentEndpoint>();
let override: KookAgentDeps | null = null;

export function registerKookAgentEndpoint(
  endpointKey: string,
  endpoint: KookAgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
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
    getEndpoint(endpointKey: string): KookAgentEndpoint {
      const registered = endpoints.get(endpointKey);
      if (!registered) throw new Error(`Endpoint ${endpointKey} 不存在`);
      return registered;
    },
  };
}
