import type {
  ChatMessage,
  MemoryIMSessionStore,
  IMSessionStore,
  MemoryAgentSessionStore,
  AgentSessionStore,
  ContextRepository,
  CreateIMSessionInput,
  CreateAgentSessionInput,
} from '@zhin.js/ai';
import { agentMessagesToOpenAi } from '@zhin.js/ai';
import type { ToolContext } from '@zhin.js/core';
import {
  formatSenderRolesForLabel,
  stripUserSpoofedSenderPrefix,
} from '@zhin.js/core';

export interface SessionIODeps {
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
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
): CreateIMSessionInput & CreateAgentSessionInput {
  return {
    session_key: sessionKey,
    platform: context.platform || '',
    bot_id: context.botId || '',
    scene_id: context.sceneId || '',
    scene_type: context.scope || 'private',
  };
}

export function buildImTranscriptQuery(
  context: Pick<ToolContext, 'platform' | 'botId' | 'sceneId'>,
): import('@zhin.js/ai').ImTranscriptQuery {
  return {
    platform: context.platform || '',
    botId: context.botId || '',
    sceneId: context.sceneId || '',
  };
}

export async function buildHistoryMessagesFromContext(
  deps: SessionIODeps,
  sessionId: string,
  currentUserContent: string,
): Promise<ChatMessage[]> {
  const loaded = await deps.contextRepository.loadContext(sessionId);
  const history = agentMessagesToOpenAi(loaded.messages);
  return [...history, { role: 'user', content: currentUserContent }];
}

/**
 * 在 `getOrCreateActive` 之前调用：是否视为新会话纪元（用于 ai.session.new）。
 */
export async function resolveSessionIsNewBeforeCreate(
  deps: SessionIODeps,
  sessionKey: string,
): Promise<boolean> {
  const active = await deps.agentSessionStore.findActive(sessionKey);
  return !active;
}

export async function beginTurnSession(
  deps: SessionIODeps,
  sessionKey: string,
  context: Pick<ToolContext, 'platform' | 'botId' | 'scope' | 'sceneId'>,
): Promise<{ sessionKey: string; sessionId: string }> {
  const input = buildSessionCreateInput(sessionKey, context);
  const record = await deps.agentSessionStore.getOrCreateActive(input);
  return { sessionKey, sessionId: record.session_id };
}

export async function touchSession(
  deps: SessionIODeps,
  sessionId: string,
): Promise<void> {
  await deps.agentSessionStore.touch(sessionId);
}

export async function archiveSessionByKey(
  deps: SessionIODeps,
  sessionKey: string,
): Promise<boolean> {
  await deps.contextRepository.archiveSession(sessionKey);
  return deps.agentSessionStore.archiveByKey(sessionKey);
}
