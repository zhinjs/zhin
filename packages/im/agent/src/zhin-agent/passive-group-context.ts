/**
 * 群/频道旁听：未 @ 机器人的消息写入内存缓冲，@ 触发时与当前消息合并进 LLM 上下文。
 */
import type { Message } from '@zhin.js/core';
import type { CollaborationScene } from '../collaboration/types.js';
import { resolveAgentSessionKeyForTurn } from '../collaboration/resolve-agent-session-key.js';
import { buildSessionCreateInput, prepareUserContentForSession } from './session-io.js';
import { pushPassiveGroupLine } from './passive-group-buffer.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

function resolveSenderDisplayName(message: Message): string {
  if (!message?.$sender) return 'unknown';
  const sender = message.$sender as { nickname?: string; name?: string; id?: string };
  const raw = sender.nickname || sender.name || sender.id;
  return raw != null ? String(raw).trim().slice(0, 64) : 'unknown';
}

export async function appendPassiveGroupMessageToContext(
  agent: ZhinAgentPrivate,
  message: Message,
  rawText: string,
  cell?: CollaborationScene,
): Promise<void> {
  const { content } = prepareUserContentForSession(message, rawText);
  if (!content.trim()) return;

  const sessionKey = resolveAgentSessionKeyForTurn(message, cell);
  const sessionInput = buildSessionCreateInput(sessionKey, message);
  await agent.agentSessionStore.getOrCreateActive(sessionInput);

  pushPassiveGroupLine(sessionKey, {
    senderId: String(message.$sender?.id ?? 'unknown'),
    senderName: resolveSenderDisplayName(message),
    text: content,
    at: Date.now(),
  });
}
