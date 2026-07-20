/**
 * Agent tool deps for telegram.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

import type { TelegramChatMember } from './protocol.js';

export interface TelegramAgentEndpoint {
  pinMessage(chatId: number, messageId: number): Promise<boolean>;
  unpinMessage(chatId: number, messageId?: number): Promise<boolean>;
  setChatDescription(chatId: number, description: string): Promise<boolean>;
  setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<boolean>;
  getChatMemberCount(chatId: number): Promise<number>;
  getChatAdmins(chatId: number): Promise<TelegramChatMember[]>;
  sendStickerMessage(chatId: number, sticker: string): Promise<{ message_id: number }>;
  setChatPermissionsAll(
    chatId: number,
    permissions: Record<string, boolean | undefined>,
  ): Promise<boolean>;
  createInviteLink(chatId: number): Promise<string>;
  sendPoll(
    chatId: number,
    question: string,
    options: string[],
    isAnonymous?: boolean,
    allowsMultipleAnswers?: boolean,
  ): Promise<{ message_id: number }>;
}

export interface TelegramAgentDeps {
  getEndpoint: (endpointId: string) => TelegramAgentEndpoint;
}

const endpoints = new Map<string, TelegramAgentEndpoint>();
let override: TelegramAgentDeps | null = null;

export function registerTelegramAgentEndpoint(
  endpointId: string,
  endpoint: TelegramAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setTelegramAgentDeps(deps: TelegramAgentDeps | null): void {
  override = deps;
}

export function getTelegramAgentDeps(): TelegramAgentDeps {
  if (override) return override;
  return {
    getEndpoint(endpointId: string): TelegramAgentEndpoint {
      const registered = endpoints.get(endpointId);
      if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
      return registered;
    },
  };
}
