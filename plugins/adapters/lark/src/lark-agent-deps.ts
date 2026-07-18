/**
 * Agent tool deps for lark (user / chat / managers / upload).
 * Endpoints register themselves on start; tools look up by endpoint id.
 */

export interface LarkAgentEndpoint {
  getUserInfo(
    userId: string,
    userIdType?: 'open_id' | 'user_id' | 'union_id',
  ): Promise<unknown>;
  getChatInfo(chatId: string): Promise<unknown>;
  uploadFile(
    filePath: string,
    fileType?: 'image' | 'file' | 'video' | 'audio',
  ): Promise<string | null>;
  createChat(name: string, userIds: string[], ownerId?: string): Promise<string | null>;
  updateChatInfo(
    chatId: string,
    options: { name?: string; description?: string },
  ): Promise<boolean>;
  addChatMembers(chatId: string, userIds: string[]): Promise<boolean>;
  removeChatMembers(chatId: string, userIds: string[]): Promise<boolean>;
  getChatMembers(chatId: string): Promise<unknown[]>;
  dissolveChat(chatId: string): Promise<boolean>;
  setChatManagers(chatId: string, userIds: string[]): Promise<boolean>;
  removeChatManagers(chatId: string, userIds: string[]): Promise<boolean>;
}

export interface LarkAgentDeps {
  getEndpoint: (endpointId: string) => LarkAgentEndpoint;
}

const endpoints = new Map<string, LarkAgentEndpoint>();
let override: LarkAgentDeps | null = null;

export function registerLarkAgentEndpoint(
  endpointId: string,
  endpoint: LarkAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setLarkAgentDeps(deps: LarkAgentDeps | null): void {
  override = deps;
}

export function getLarkAgentDeps(): LarkAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId) {
      const endpoint = endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
  };
}
