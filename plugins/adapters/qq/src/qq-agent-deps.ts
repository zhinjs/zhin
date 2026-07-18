/**
 * Agent tool deps for qq.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface QqAgentEndpoint {
  getGuilds(): Promise<unknown[]>;
  getChannels(guildId: string): Promise<unknown[]>;
  getChannelInfo(channelId: string): Promise<unknown>;
  getGuildMember(guildId: string, userId: string): Promise<unknown>;
  getGuildRoles(guildId: string): Promise<unknown[]>;
  createGuildRole(guildId: string, name: string, color?: number): Promise<unknown>;
  addMemberRole(
    guildId: string,
    channelId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean>;
  removeMemberRole(
    guildId: string,
    channelId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean>;
}

export interface QqAgentDeps {
  getEndpoint: (endpointId: string) => QqAgentEndpoint;
}

const endpoints = new Map<string, QqAgentEndpoint>();
let override: QqAgentDeps | null = null;

export function registerQqAgentEndpoint(
  endpointId: string,
  endpoint: QqAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setQqAgentDeps(deps: QqAgentDeps | null): void {
  override = deps;
}

export function getQqAgentDeps(): QqAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId: string): QqAgentEndpoint {
      const registered = endpoints.get(endpointId);
      if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
      return registered;
    },
  };
}
