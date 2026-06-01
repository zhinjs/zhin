/**
 * NapCat 入站消息治理：去重、自发过滤、消息归一化
 */
import type { NapCatMessageEvent, MessageSegment } from './types.js';

const DEDUPE_TTL_MS = 120_000;

export class InboundMessageDeduper {
  private readonly seen = new Map<string, number>();

  shouldProcess(messageId: string): boolean {
    const now = Date.now();
    for (const [id, t] of this.seen) {
      if (now - t > DEDUPE_TTL_MS) this.seen.delete(id);
    }
    if (this.seen.has(messageId)) return false;
    this.seen.set(messageId, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}

/** 判断是否为 bot 自身发出的消息 */
export function isSelfMessage(event: NapCatMessageEvent): boolean {
  if (event.post_type === 'message_sent') return true;
  if (event.self_id != null && event.user_id != null) {
    return Number(event.self_id) === Number(event.user_id);
  }
  return false;
}

/**
 * 将 message 字段归一化为 MessageSegment[]。
 * NapCat 通常返回数组，但某些配置下可能返回 CQ 字符串。
 */
export function normalizeMessage(message: MessageSegment[] | string): MessageSegment[] {
  if (Array.isArray(message)) return message;
  if (typeof message === 'string') {
    return [{ type: 'text', data: { text: message } }];
  }
  return [];
}

/**
 * 生成用于 notice / request 事件的去重 key
 */
export function resolveSideEventDedupeKey(event: any, prefix: string): string {
  const parts = [prefix, event.time, event.notice_type || event.request_type];
  if (event.group_id) parts.push(event.group_id);
  if (event.user_id) parts.push(event.user_id);
  if (event.message_id) parts.push(event.message_id);
  if (event.flag) parts.push(event.flag);
  return parts.join(':');
}
