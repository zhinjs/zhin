/**
 * Agent tool deps for slack.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface SlackAgentEndpoint {
  inviteToChannel(channel: string, users: string[]): Promise<boolean>;
  kickFromChannel(channel: string, user: string): Promise<boolean>;
  setChannelTopic(channel: string, topic: string): Promise<boolean>;
  setChannelPurpose(channel: string, purpose: string): Promise<boolean>;
  archiveChannel(channel: string): Promise<boolean>;
  unarchiveChannel(channel: string): Promise<boolean>;
  renameChannel(channel: string, name: string): Promise<boolean>;
  getChannelMembers(channel: string): Promise<string[]>;
  getChannelInfo(channel: string): Promise<unknown>;
  getUserInfo(user: string): Promise<unknown>;
  addReaction(channel: string, timestamp: string, name: string): Promise<boolean>;
  removeReaction(channel: string, timestamp: string, name: string): Promise<boolean>;
  pinMessage(channel: string, timestamp: string): Promise<boolean>;
  unpinMessage(channel: string, timestamp: string): Promise<boolean>;
  editMessage(channel: string, messageTs: string, content: unknown): Promise<void>;
}

export interface SlackAgentDeps {
  getEndpoint: (endpointId: string) => SlackAgentEndpoint;
}

const endpoints = new Map<string, SlackAgentEndpoint>();
let override: SlackAgentDeps | null = null;

export function registerSlackAgentEndpoint(
  endpointId: string,
  endpoint: SlackAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setSlackAgentDeps(deps: SlackAgentDeps | null): void {
  override = deps;
}

export function getSlackAgentDeps(): SlackAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId: string): SlackAgentEndpoint {
      const registered = endpoints.get(endpointId);
      if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
      return registered;
    },
  };
}
