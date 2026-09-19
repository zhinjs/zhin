import { type AgentSessionRepository, type ContextRepository, type CreateAgentSessionInput, type AgentMessage, type ConversationActor, createUserMessage, renderUserMessageForLlm, type UserMessage } from '@zhin.js/ai';
import { type AgentTurnMessage, type Message, formatSenderRolesForLabel, resolveSceneFieldsFromMessage, senderRolesFromMessage, stripUserSpoofedSenderPrefix } from '@zhin.js/core';
export interface SessionIODeps {
  agentSessionStore: AgentSessionRepository;
  contextRepository: ContextRepository;
}

function resolveSenderDisplayName(message: Message): string {
  if (!message?.$sender) return 'unknown';
  const sender = message.$sender as { nickname?: string; name?: string; id?: string };
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

function resolveSenderRoleLabels(commMessage: Message): string[] {
  const labels = formatSenderRolesForLabel([...senderRolesFromMessage(commMessage)])
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r && r !== 'user');
  const platform = mapPlatformRoleForLabel(commMessage.$sender.role);
  if (platform && !labels.includes(platform)) labels.push(platform);
  return labels.length > 0 ? labels : ['user'];
}

/** 将 IM 参与者投影为 AgentMessage 的唯一身份权威。 */
export function buildUserMessageActor(commMessage: Message): ConversationActor {
  const scope = commMessage.$channel?.type || 'private';
  const roleLabels = resolveSenderRoleLabels(commMessage);
  return {
    subjectId: String(commMessage.$sender.id || 'unknown'),
    displayName: resolveSenderDisplayName(commMessage),
    roles: roleLabels.length > 0 ? roleLabels : ['user'],
    scope: scope === 'group' || scope === 'channel' ? scope : 'private',
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
  const llmMessage = renderUserMessageForLlm(
    createUserMessage(content, undefined, Date.now(), actor),
  );
  return { content, llmMessage };
}

export function buildAgentSessionCreateInput(
  sessionKey: string,
): CreateAgentSessionInput {
  return { session_key: sessionKey };
}

export async function buildHistoryMessagesFromContext(
  deps: SessionIODeps,
  sessionId: string,
  currentUserContent: string,
): Promise<AgentMessage[]> {
  const loaded = await deps.contextRepository.loadContext(sessionId);
  const timestamp = Date.now();
  return [...loaded.messages, { role: 'user', content: [{ type: 'text', text: currentUserContent }], timestamp }];
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
