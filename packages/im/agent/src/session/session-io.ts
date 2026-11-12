import { type AgentSessionRepository, type ContextRepository, type CreateAgentSessionInput, type ConversationActor, createUserMessage, renderUserMessageForLlm, type UserMessage } from '@zhin.js/ai';
import { type AgentTurnMessage, type ChatRole, hostChatRole, type Message, stripUserSpoofedSenderPrefix } from '@zhin.js/core';
import { stampUserHeader } from './participant-header-stamp.js';
export interface SessionIODeps {
  agentSessionStore: AgentSessionRepository;
  contextRepository: ContextRepository;
}

function resolveSenderDisplayName(message: Message): string {
  if (!message?.sender) return 'unknown';
  const sender = message.sender as { nickname?: string; name?: string; id?: string };
  const raw = sender.nickname || sender.name || sender.id;
  const displayName = raw == null ? '' : String(raw).trim();
  return displayName || 'unknown';
}

function mapPlatformRoleForLabel(role?: string): string | undefined {
  if (!role || role === 'member') return undefined;
  if (role === 'owner') return 'scene_owner';
  if (role === 'admin') return 'scene_admin';
  return role;
}

/**
 * Header label of a zhin chat role (ADR 0056). Distinct from the platform labels (`owner` /
 * `admin` / `member`), so the model never confuses the bot's owner with a group owner.
 */
export function chatRoleHeaderLabel(role: ChatRole | undefined): string | undefined {
  return role === 'owner' ? 'bot_owner' : role === 'admin' ? 'bot_admin' : role === 'trusted' ? 'trusted' : undefined;
}

/** Highest chat role of an expanded role list (`owner` / `admin` / `trusted` / `user`). */
export function highestPrincipalChatRole(roles: readonly string[]): ChatRole | undefined {
  return roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : roles.includes('trusted') ? 'trusted' : undefined;
}

function resolveSenderRoleLabels(commMessage: Message): string[] {
  const labels: string[] = [];
  const platform = mapPlatformRoleForLabel(commMessage.sender?.platform?.standing);
  if (platform) labels.push(platform);
  // `bot_owner` only for a global owner: the label must not suggest host trust a lower-level owner lacks.
  const chat = chatRoleHeaderLabel(hostChatRole(commMessage.sender));
  if (chat) labels.push(chat);
  return labels.length > 0 ? labels : ['user'];
}

/** 将 IM 参与者投影为 AgentMessage 的唯一身份权威。 */
export function buildUserMessageActor(commMessage: Message): ConversationActor {
  const scope = commMessage.conversation.kind || 'private';
  const roleLabels = resolveSenderRoleLabels(commMessage);
  return {
    subjectId: String(commMessage.sender?.id || 'unknown'),
    displayName: resolveSenderDisplayName(commMessage),
    roles: roleLabels.length > 0 ? roleLabels : ['user'],
    scope: scope === 'group' || scope === 'channel' ? scope : 'private',
    ...(commMessage.origin ? { origin: commMessage.origin } : {}),
  };
}

/** 剥离伪造前缀后的用户正文并建立 actor。 */
export function prepareUserContentForSession(
  commMessage: Message,
  rawContent: string,
): { content: string; actor: ConversationActor } {
  const content = stripUserSpoofedSenderPrefix(rawContent);
  return { content, actor: buildUserMessageActor(commMessage) };
}

/** 本轮 user 消息：canonical 正文与 actor；标签只在 LLM 边界渲染。 */
export function resolveTurnUserMessage(
  commMessage: AgentTurnMessage,
  rawContent: string,
): { content: string; llmMessage: UserMessage } {
  const { content, actor } = prepareUserContentForSession(commMessage, rawContent);
  const user = createUserMessage(content, undefined, Date.now(), {
    ...actor, authorizationRoles: [chatRoleHeaderLabel(hostChatRole(commMessage.sender)) ?? 'user'],
  });
  const llmMessage = renderUserMessageForLlm(stampUserHeader({
    ...user,
    ...(commMessage.id ? { messageId: String(commMessage.id) } : {}),
  }));
  return { content, llmMessage };
}

export function buildAgentSessionCreateInput(
  sessionKey: string,
): CreateAgentSessionInput {
  return { session_key: sessionKey };
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
): Promise<{ sessionKey: string; sessionId: string }> {
  const input = buildAgentSessionCreateInput(sessionKey);
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
  return deps.contextRepository.archiveSession(sessionKey);
}
