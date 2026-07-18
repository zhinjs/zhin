/**
 * Agent tool deps for napcat.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

export interface NapcatAgentEndpoint {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
  setTitle(groupId: number, userId: number, title: string, duration?: number): Promise<boolean>;
  sendLike(userId: number, times?: number): Promise<unknown>;
  deleteFriend(userId: number): Promise<unknown>;
  markMsgAsRead(messageId: number): Promise<unknown>;
  ocrImage(image: string): Promise<unknown>;
  setQQProfile(
    nickname: string,
    company?: string,
    email?: string,
    college?: string,
    personalNote?: string,
  ): Promise<unknown>;
  setGroupPortrait(groupId: number, file: string): Promise<unknown>;
  setEssenceMsg(messageId: number): Promise<unknown>;
  deleteEssenceMsg(messageId: number): Promise<unknown>;
  getEssenceMsgList(groupId: number): Promise<unknown>;
  sendGroupSign(groupId: number): Promise<unknown>;
  sendGroupNotice(groupId: number, content: string, image?: string): Promise<unknown>;
  getGroupNotice(groupId: number): Promise<unknown>;
  deleteGroupNotice(groupId: number, noticeId: string): Promise<unknown>;
  uploadGroupFile(groupId: number, file: string, name: string, folder?: string): Promise<unknown>;
  getGroupRootFiles(groupId: number): Promise<unknown>;
  getGroupFileUrl(groupId: number, fileId: string, busid: number): Promise<unknown>;
  downloadFile(url: string, threadCount?: number, headers?: string[]): Promise<unknown>;
  setOnlineStatus(status: number, extStatus: number): Promise<unknown>;
  setQQAvatar(file: string): Promise<unknown>;
  forwardFriendSingleMsg(userId: number, messageId: number): Promise<unknown>;
  forwardGroupSingleMsg(groupId: number, messageId: number): Promise<unknown>;
  translateEn2Zh(sourceText: string): Promise<unknown>;
  setMsgEmojiLike(messageId: number, emojiId: string): Promise<unknown>;
  sendForwardMsg(messageType: 'private' | 'group', id: number, messages: unknown[]): Promise<unknown>;
  getFriendMsgHistory(userId: number, messageSeq?: number, count?: number): Promise<unknown>;
  getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number): Promise<unknown>;
  setSelfLongnick(longnick: string): Promise<unknown>;
  getGroupInfoEx(groupId: number): Promise<unknown>;
  sendPoke(userId: number, groupId?: number): Promise<unknown>;
  ncGetUserStatus(userId: number): Promise<unknown>;
  getGroupShutList(groupId: number): Promise<unknown>;
  getMiniAppArk(
    type: string,
    title: string,
    desc: string,
    picUrl: string,
    jumpUrl: string,
  ): Promise<unknown>;
  getAiCharacters(groupId: number): Promise<unknown>;
  sendGroupAiRecord(groupId: number, characterId: string, text: string): Promise<unknown>;
}

export interface NapcatAgentDeps {
  getEndpoint: (endpointId: string) => NapcatAgentEndpoint;
}

const endpoints = new Map<string, NapcatAgentEndpoint>();
let override: NapcatAgentDeps | null = null;

export function registerNapcatAgentEndpoint(
  endpointId: string,
  endpoint: NapcatAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setNapcatAgentDeps(deps: NapcatAgentDeps | null): void {
  override = deps;
}

function lookup(endpointId: string): NapcatAgentEndpoint {
  const registered = endpoints.get(endpointId);
  if (!registered) throw new Error(`Endpoint ${endpointId} not found`);
  return registered;
}

export function getNapcatAgentDeps(): NapcatAgentDeps {
  if (override) return override;
  return { getEndpoint: lookup };
}

/** Convenience for agent/tools (unchanged call sites). */
export function getEndpoint(endpointId: string): NapcatAgentEndpoint {
  return getNapcatAgentDeps().getEndpoint(endpointId);
}
