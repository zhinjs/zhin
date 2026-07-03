/**
 * 群/频道旁听缓冲：未 @ 的消息先入内存，@ 触发时再与当前 @ 合并发给 LLM。
 */
import { HISTORY_CONTEXT_MARKER } from './config.js';

export interface PassiveGroupLine {
  senderId: string;
  senderName?: string;
  text: string;
  at: number;
}

const buffers = new Map<string, PassiveGroupLine[]>();

export function pushPassiveGroupLine(sessionKey: string, line: PassiveGroupLine): void {
  const list = buffers.get(sessionKey) ?? [];
  list.push(line);
  buffers.set(sessionKey, list);
}

export function drainPassiveGroupBuffer(sessionKey: string): PassiveGroupLine[] {
  const list = buffers.get(sessionKey) ?? [];
  buffers.delete(sessionKey);
  return list;
}

/** 测试 / 诊断 */
export function peekPassiveGroupBuffer(sessionKey: string): readonly PassiveGroupLine[] {
  return buffers.get(sessionKey) ?? [];
}

export function formatPassiveGroupContextBlock(lines: readonly PassiveGroupLine[]): string | null {
  if (lines.length === 0) return null;
  const body = lines
    .map((line) => {
      const name = (line.senderName?.trim() || line.senderId).replace(/[\]\s]+/g, '_').slice(0, 64);
      const id = line.senderId.trim() || 'unknown';
      return `[sender:id=${id} name=${name} roles=user] ${line.text}`;
    })
    .join('\n');
  return [
    HISTORY_CONTEXT_MARKER,
    'Group messages since your last reply (not @mentions; background only — respond to the current @ message below).',
    body,
  ].join('\n');
}
