import type { AgentTurnMessage, Message } from '@zhin.js/core';
import { QUOTE_CONTEXT_SYSTEM_EXTRA_KEY, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { getFileMemoryContext, formatMemoryPathsHint } from '../memory-layers.js';

export const TURN_CONTEXT_BEGIN = '[Turn context]';
export const TURN_CONTEXT_END = '[/Turn context]';

export interface TurnContextEnvelopeInput {
  commMessage?: Message;
  profileSummary?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  quoteSystemHint?: string;
  collaborationHint?: string;
  modelLine?: string;
  sdk?: string;
  agentsContext?: string;
}

export function formatSessionContextLine(commMessage: Message): string | null {
  const parts: string[] = [];
  if (commMessage.$adapter) parts.push(`platform:${commMessage.$adapter}`);
  if (commMessage.$endpoint) parts.push(`endpoint:${commMessage.$endpoint}`);
  if (commMessage.$channel?.type && commMessage.$channel?.id) {
    parts.push(`${commMessage.$channel.type}_id:${commMessage.$channel.id}`);
  }
  if (parts.length === 0) return null;
  return `Session: ${parts.join(' | ')}`;
}

export function resolveQuoteSystemHint(commMessage?: AgentTurnMessage): string | undefined {
  const hint = commMessage?.extra?.[QUOTE_CONTEXT_SYSTEM_EXTRA_KEY];
  if (typeof hint !== 'string' || !hint.trim()) return undefined;
  return hint.trim();
}

export function buildTurnContextEnvelope(input: TurnContextEnvelopeInput): string | null {
  const lines: string[] = [];
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = now.toLocaleString('zh-CN', { timeZone: tz });
  lines.push(`Time: ${timeStr} (${tz})`);

  if (input.modelLine?.trim()) {
    lines.push(`Model: ${input.modelLine.trim()}`);
  }
  if (input.sdk?.trim()) {
    lines.push(`Sdk: ${input.sdk.trim()}`);
  }

  if (input.commMessage) {
    const sessionLine = formatSessionContextLine(input.commMessage);
    if (sessionLine) lines.push(sessionLine);
    const sessionKey = resolveIMSessionIdFromMessage(input.commMessage);
    const memoryPaths = formatMemoryPathsHint(
      String(input.commMessage.$adapter),
      sessionKey,
    );
    if (memoryPaths) lines.push(`Memory paths: ${memoryPaths}`);
    const fileMemory = getFileMemoryContext(
      undefined,
      String(input.commMessage.$adapter),
      sessionKey,
    );
    if (fileMemory?.trim()) {
      lines.push('Memory snapshot:');
      lines.push(fileMemory.trim());
    }
  }

  if (input.deferredStats?.trim()) {
    lines.push(`Deferred catalog: ${input.deferredStats.trim()}`);
  }
  if (input.profileSummary?.trim()) {
    lines.push(input.profileSummary.trim());
  }
  if (input.toneHint?.trim()) {
    lines.push(`[Tone hint] ${input.toneHint.trim()}`);
  }
  if (input.activeSkillsContext?.trim()) {
    lines.push(input.activeSkillsContext.trim());
  }
  if (input.quoteSystemHint?.trim()) {
    lines.push(input.quoteSystemHint.trim());
  }
  if (input.collaborationHint?.trim()) {
    lines.push(input.collaborationHint.trim());
  }
  if (input.agentsContext?.trim()) {
    lines.push(input.agentsContext.trim());
  }

  if (lines.length === 0) return null;
  return `${TURN_CONTEXT_BEGIN}\n${lines.join('\n')}\n${TURN_CONTEXT_END}`;
}

export function prependTurnContextEnvelope(content: string, envelope: string | null | undefined): string {
  if (!envelope?.trim()) return content;
  return `${envelope.trim()}\n\n${content}`;
}
