/**
 * Agent tool deps for discord.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface DiscordAgentEndpoint {
  addRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  getRoles(guildId: string): Promise<unknown[]>;
  createThread(
    channelId: string,
    name: string,
    messageId?: string,
    autoArchiveDuration?: number,
  ): Promise<{ id: string }>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  sendEmbed(
    channelId: string,
    embedData: Record<string, unknown>,
  ): Promise<{ id: string }>;
  createForumPost(
    channelId: string,
    name: string,
    content: string,
    tags?: string[],
  ): Promise<{ id: string }>;
  kickMember(guildId: string, userId: string, reason?: string): Promise<boolean>;
  banMember(guildId: string, userId: string, reason?: string): Promise<boolean>;
  unbanMember(guildId: string, userId: string, reason?: string): Promise<boolean>;
  timeoutMember(
    guildId: string,
    userId: string,
    duration?: number,
    reason?: string,
  ): Promise<boolean>;
  setNickname(guildId: string, userId: string, nickname: string): Promise<boolean>;
  getMembers(guildId: string, limit?: number): Promise<unknown[]>;
  getGuildInfo(guildId: string): Promise<unknown>;
}

export interface DiscordAgentDeps {
  getEndpoint: (endpointKey: string) => DiscordAgentEndpoint;
  /** Alias kept for existing agent/tools that call getGatewayEndpoint. */
  getGatewayEndpoint: (endpointKey: string) => DiscordAgentEndpoint;
}

const endpoints = new Map<string, DiscordAgentEndpoint>();
let override: DiscordAgentDeps | null = null;

export function registerDiscordAgentEndpoint(
  endpointKey: string,
  endpoint: DiscordAgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setDiscordAgentDeps(deps: DiscordAgentDeps | null): void {
  override = deps;
}

function lookup(endpointKey: string): DiscordAgentEndpoint {
  const registered = endpoints.get(endpointKey);
  if (!registered) throw new Error(`Endpoint ${endpointKey} 不存在`);
  return registered;
}

export function getDiscordAgentDeps(): DiscordAgentDeps {
  if (override) return override;
  return {
    getEndpoint: lookup,
    getGatewayEndpoint: lookup,
  };
}
