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
  createUserMessage,
  renderUserMessageForLlm,
  type AgentMessageExtra,
  type AgentMessageSenderExtra,
  type UserMessage,
} from '@zhin.js/ai';
import {
  formatSenderRolesForLabel,
  QUOTE_CONTEXT_BLOCK_EXTRA_KEY,
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

/** 群/频道 user 消息的 sender 元数据（写入 `agent_messages.extra`） */
export function buildUserMessageExtra(
  context: Pick<ToolContext, 'scope' | 'senderId' | 'roles' | 'message'>,
): AgentMessageExtra | undefined {
  const scope = context.scope || 'private';
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sender: AgentMessageSenderExtra = {
    id: sanitizeSenderAttr(String(context.senderId || 'unknown')),
    name: resolveSenderDisplayName(context.message),
    roles: formatSenderRolesForLabel(context.roles ?? ['user'])
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    scope,
  };
  if (sender.roles.length === 0) sender.roles = ['user'];
  return { sender };
}

/** 剥离伪造前缀后的用户正文 + 可选 extra（入库 payload 用） */
export function prepareUserContentForSession(
  context: Pick<ToolContext, 'scope' | 'senderId' | 'roles' | 'message'>,
  rawContent: string,
): { content: string; extra?: AgentMessageExtra } {
  const content = stripUserSpoofedSenderPrefix(rawContent);
  const extra = buildUserMessageExtra(context);
  return { content, extra };
}

/** 本轮 user 消息：干净正文 + extra + LLM 渲染（引用/sender 仅 extra + 加载时拼接） */
export function resolveTurnUserMessage(
  context: Pick<ToolContext, 'scope' | 'senderId' | 'roles' | 'message' | 'extra'>,
  rawContent: string,
): { content: string; extra?: AgentMessageExtra; llmMessage: UserMessage } {
  const { content, extra: senderExtra } = prepareUserContentForSession(context, rawContent);
  const quoteBlock = context.extra?.[QUOTE_CONTEXT_BLOCK_EXTRA_KEY];
  const extra: AgentMessageExtra = {
    ...senderExtra,
    ...(typeof quoteBlock === 'string' && quoteBlock.trim()
      ? { quote: { block: quoteBlock.trim(), messageId: context.message?.$quote_id } }
      : {}),
  };
  const hasExtra = !!(extra.sender || extra.quote);
  const llmMessage = renderUserMessageForLlm(createUserMessage(content), hasExtra ? extra : undefined);
  return { content, extra: hasExtra ? extra : undefined, llmMessage };
}

/** @deprecated 使用 `resolveTurnUserMessage` */
export function formatUserContentForSession(
  context: Pick<ToolContext, 'scope' | 'senderId' | 'roles' | 'message' | 'extra'>,
  rawContent: string,
): string {
  const { llmMessage } = resolveTurnUserMessage(context, rawContent);
  if (llmMessage.role !== 'user') return rawContent;
  const block = llmMessage.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text : rawContent;
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
