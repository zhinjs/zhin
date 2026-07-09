/**
 * 群/频道 Passive Group 上下文 — session key SSOT + buffer record/drain。
 */
import type { Message } from '@zhin.js/core';
import type { CollaborationScene } from '../collaboration/types.js';
import { resolveAgentTurnSessionKey } from '../collaboration/resolve-agent-session-key.js';
import { buildSessionCreateInput, prepareUserContentForSession } from './session-io.js';
import {
  drainPassiveGroupBuffer,
  formatPassiveGroupContextBlock,
  pushPassiveGroupLine,
} from './passive-group-buffer.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

function resolveSenderDisplayName(message: Message): string {
  if (!message?.$sender) return 'unknown';
  const sender = message.$sender as { nickname?: string; name?: string; id?: string };
  const raw = sender.nickname || sender.name || sender.id;
  return raw != null ? String(raw).trim().slice(0, 64) : 'unknown';
}

export function resolvePassiveGroupSessionKey(
  message: Message,
  cell?: CollaborationScene,
): string {
  return resolveAgentTurnSessionKey(message, cell);
}

export async function recordPassiveGroupMessage(
  agent: ZhinAgentPrivate,
  message: Message,
  rawText: string,
  cell?: CollaborationScene,
): Promise<void> {
  const { content } = prepareUserContentForSession(message, rawText);
  if (!content.trim()) return;

  const sessionKey = resolvePassiveGroupSessionKey(message, cell);
  const sessionInput = buildSessionCreateInput(sessionKey, message);
  await agent.agentSessionStore.getOrCreateActive(sessionInput);

  pushPassiveGroupLine(sessionKey, {
    senderId: String(message.$sender?.id ?? 'unknown'),
    senderName: resolveSenderDisplayName(message),
    text: content,
    at: Date.now(),
  });
}

export function consumePassiveGroupContextForTurn(message: Message): string | null {
  const sessionKey = resolvePassiveGroupSessionKey(message);
  return formatPassiveGroupContextBlock(drainPassiveGroupBuffer(sessionKey));
}

/** @deprecated use recordPassiveGroupMessage */
export async function appendPassiveGroupMessageToContext(
  agent: ZhinAgentPrivate,
  message: Message,
  rawText: string,
  cell?: CollaborationScene,
): Promise<void> {
  await recordPassiveGroupMessage(agent, message, rawText, cell);
}
