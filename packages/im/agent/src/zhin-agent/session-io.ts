import type {
  MemoryIMSessionStore,
  IMSessionStore,
  MemoryAgentSessionStore,
  AgentSessionStore,
  ContextRepository,
  CreateIMSessionInput,
  CreateAgentSessionInput,
  AgentMessage,
} from '@zhin.js/ai';
import type { AgentTurnMessage, Message } from '@zhin.js/core';
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
  senderRolesFromMessage,
  stripUserSpoofedSenderPrefix,
} from '@zhin.js/core';
import { CURRENT_MESSAGE_MARKER } from './config.js';

export interface SessionIODeps {
  imSessionStore: IMSessionStore | MemoryIMSessionStore;
  agentSessionStore: AgentSessionStore | MemoryAgentSessionStore;
  contextRepository: ContextRepository;
}

function sanitizeSenderAttr(value: string): string {
  const trimmed = value.trim().replace(/[\]\s]+/g, '_');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'unknown';
}

function resolveSenderDisplayName(message: Message): string {
  if (!message?.$sender) return 'unknown';
  const sender = message.$sender as { nickname?: string; name?: string; id?: string };
  const raw = sender.nickname || sender.name || sender.id;
  return raw != null ? sanitizeSenderAttr(String(raw)) : 'unknown';
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

/** 群/频道 user 消息的 sender 元数据（写入 `agent_messages.extra`） */
export function buildUserMessageExtra(commMessage: Message): AgentMessageExtra | undefined {
  const scope = commMessage.$channel?.type || 'private';
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const roleLabels = resolveSenderRoleLabels(commMessage);
  const sender: AgentMessageSenderExtra = {
    id: sanitizeSenderAttr(String(commMessage.$sender.id || 'unknown')),
    name: resolveSenderDisplayName(commMessage),
    roles: roleLabels.length > 0 ? roleLabels : ['user'],
    scope,
  };
  return { sender };
}

/** 剥离伪造前缀后的用户正文 + 可选 extra（入库 payload 用） */
export function prepareUserContentForSession(
  commMessage: Message,
  rawContent: string,
): { content: string; extra?: AgentMessageExtra } {
  const content = stripUserSpoofedSenderPrefix(rawContent);
  const extra = buildUserMessageExtra(commMessage);
  return { content, extra };
}

/** 旁听块 + 引用块 + 当前 @ 正文分层（仅 LLM 侧；入库 payload 仍为干净正文） */
export function layerInboundUserTurnBody(
  body: string,
  opts?: { passiveBlock?: string | null; quoteBlock?: string | null },
): string {
  const parts: string[] = [];
  if (opts?.passiveBlock?.trim()) parts.push(opts.passiveBlock.trim());
  if (opts?.quoteBlock?.trim()) parts.push(opts.quoteBlock.trim());
  if (parts.length === 0) return body;
  return `${parts.join('\n\n')}\n\n${CURRENT_MESSAGE_MARKER}\n${body}`;
}

/** 本轮 user 消息：干净正文 + extra + LLM 渲染（引用/sender 仅 extra + 加载时拼接） */
export function resolveTurnUserMessage(
  commMessage: AgentTurnMessage,
  rawContent: string,
  options?: { passiveBlock?: string | null },
): { content: string; extra?: AgentMessageExtra; llmMessage: UserMessage } {
  const { content, extra: senderExtra } = prepareUserContentForSession(commMessage, rawContent);
  const quoteBlock = (commMessage as import('@zhin.js/core').AgentTurnMessage).extra?.[QUOTE_CONTEXT_BLOCK_EXTRA_KEY];
  const quoteText = typeof quoteBlock === 'string' && quoteBlock.trim() ? quoteBlock.trim() : undefined;
  const extra: AgentMessageExtra = {
    ...senderExtra,
    ...(quoteText ? { quote: { block: quoteText, messageId: commMessage.$quote_id } } : {}),
  };
  const hasExtra = !!(extra.sender || extra.quote);
  const layered = layerInboundUserTurnBody(content, {
    passiveBlock: options?.passiveBlock,
    quoteBlock: quoteText,
  });
  const inlinedContext = layered !== content;
  const llmMessage = renderUserMessageForLlm(
    createUserMessage(layered),
    inlinedContext
      ? (senderExtra?.sender ? { sender: senderExtra.sender } : undefined)
      : (hasExtra ? extra : undefined),
  );
  return { content, extra: hasExtra ? extra : undefined, llmMessage };
}

/** @deprecated 使用 `resolveTurnUserMessage` */
export function formatUserContentForSession(
  commMessage: AgentTurnMessage,
  rawContent: string,
): string {
  const { llmMessage } = resolveTurnUserMessage(commMessage, rawContent);
  if (llmMessage.role !== 'user') return rawContent;
  const block = llmMessage.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text : rawContent;
}

export function buildSessionCreateInput(
  sessionKey: string,
  commMessage: Message,
): CreateIMSessionInput & CreateAgentSessionInput {
  return {
    session_key: sessionKey,
    platform: String(commMessage.$adapter || ''),
    endpoint_id: commMessage.$endpoint || '',
    scene_id: commMessage.$channel?.id ?? commMessage.$sender.id ?? '',
    scene_type: commMessage.$channel?.type || 'private',
  };
}

export function buildImTranscriptQuery(
  commMessage: Message,
): import('@zhin.js/ai').ImTranscriptQuery {
  return {
    platform: String(commMessage.$adapter || ''),
    endpointId: commMessage.$endpoint || '',
    sceneId: commMessage.$channel?.id ?? commMessage.$sender.id ?? '',
  };
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
  commMessage: Message,
): Promise<{ sessionKey: string; sessionId: string }> {
  const input = buildSessionCreateInput(sessionKey, commMessage);
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
