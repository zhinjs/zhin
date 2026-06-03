import type {
  ChatMessage,
  ChatHistoryContext,
  ChatHistoryQuery,
  MemoryIMSessionStore,
  IMSessionStore,
  CreateIMSessionInput,
} from '@zhin.js/ai';
import type { ToolContext, SenderRole } from '@zhin.js/core';
import {
  formatSenderRolesForLabel,
  stripUserSpoofedSenderPrefix,
} from '@zhin.js/core';

export interface SessionIODeps {
  chatHistory: ChatHistoryContext | null;
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
}

function sanitizeSenderAttr(value: string): string {
  const trimmed = value.trim().replace(/[\]\s]+/g, '_');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'unknown';
}

function resolveSenderDisplayName(message: ToolContext['message']): string {
  if (!message?.$sender) return 'unknown';
  const sender = message.$sender as { nickname?: string; name?: string; id?: string };
  const raw = sender.nickname || sender.name || sender.id;
  return raw != null ? sanitizeSenderAttr(String(raw)) : 'unknown';
}

/**
 * 群/频道共享 session 写入时，为 user 消息附加结构化发言者前缀
 */
export function formatUserContentForSession(
  context: Pick<ToolContext, 'scope' | 'senderId' | 'roles' | 'message'>,
  rawContent: string,
): string {
  const scope = context.scope || 'private';
  const body = stripUserSpoofedSenderPrefix(rawContent);
  if (scope !== 'group' && scope !== 'channel') {
    return body;
  }
  const senderId = sanitizeSenderAttr(String(context.senderId || 'unknown'));
  const name = resolveSenderDisplayName(context.message);
  const roles = formatSenderRolesForLabel(context.roles ?? ['user']);
  return `[sender:id=${senderId} name=${name} roles=${roles}] ${body}`;
}

export function buildSessionCreateInput(
  sessionKey: string,
  context: Pick<ToolContext, 'platform' | 'botId' | 'scope' | 'sceneId'>,
): CreateIMSessionInput {
  return {
    session_key: sessionKey,
    platform: context.platform || '',
    bot_id: context.botId || '',
    scene_id: context.sceneId || '',
    scene_type: context.scope || 'private',
  };
}

export function buildChatHistoryQuery(
  sessionId: string,
  context: Pick<ToolContext, 'platform' | 'botId' | 'sceneId'>,
): ChatHistoryQuery {
  return {
    sessionId,
    platform: context.platform || '',
    botId: context.botId || '',
    sceneId: context.sceneId || '',
  };
}

export async function buildHistoryMessages(
  deps: SessionIODeps,
  sessionId: string,
  context: Pick<ToolContext, 'platform' | 'botId' | 'sceneId'>,
  currentUserContent: string,
): Promise<ChatMessage[]> {
  const history =
    deps.chatHistory != null
      ? await deps.chatHistory.buildHistoryMessages(
          buildChatHistoryQuery(sessionId, context),
        )
      : [];
  return [...history, { role: 'user', content: currentUserContent }];
}

/**
 * 在 `getOrCreateActive` 之前调用：是否视为新会话纪元（用于 ai.session.new）。
 * 须在 beginTurnSession 之前判定，否则同轮创建会令 hasAnySession 恒为 true。
 */
export async function resolveSessionIsNewBeforeCreate(
  deps: SessionIODeps,
  sessionKey: string,
  context: Pick<ToolContext, 'platform' | 'botId' | 'sceneId'>,
): Promise<boolean> {
  if (await deps.imSessionStore.hasAnySession(sessionKey)) return false;
  if (!deps.chatHistory) return true;
  const hasMessages = await deps.chatHistory.hasStoredMessages(
    buildChatHistoryQuery('new-check', context),
  );
  return !hasMessages;
}

export async function touchSession(
  deps: SessionIODeps,
  sessionId: string,
): Promise<void> {
  await deps.imSessionStore.touch(sessionId);
}
