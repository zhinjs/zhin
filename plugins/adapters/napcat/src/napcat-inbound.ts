/**
 * NapCat 入站消息治理：去重、自发过滤、消息归一化
 */
import type { NapCatMessageEvent, MessageSegment } from './protocol.js';

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
export function isSelfMessage(event: NapCatMessageEvent | {
  post_type?: string;
  self_id?: number | string;
  user_id?: number | string;
}): boolean {
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

const CQ_AT_RE = /\[CQ:at,qq=([^\],\s]+)\]/g;

function atTargetMatchesUin(target: unknown, uin: string): boolean {
  const qq = String(target ?? '').trim();
  return Boolean(qq) && qq !== 'all' && Number(qq) === Number(uin);
}

/**
 * OneBot11 mentioned 判定：消息段 {type:'at', data:{qq}} 的 qq 等于本机 uin
 * （事件 self_id）时为 true；`qq === 'all'` 不算。兼容 CQ 字符串形式。
 */
export function isNapCatBotMentioned(ev: {
  self_id?: number | string;
  message?: MessageSegment[] | string;
}): boolean {
  if (ev.self_id == null) return false;
  const uin = String(ev.self_id).trim();
  if (!uin) return false;
  const segments = normalizeMessage(ev.message ?? []);
  for (const seg of segments) {
    if (seg.type === 'at' && atTargetMatchesUin(seg.data?.qq, uin)) return true;
  }
  const text = segments
    .map((seg) => (seg.type === 'text' ? String(seg.data?.text ?? '') : ''))
    .join('');
  if (!text) return false;
  for (const match of text.matchAll(CQ_AT_RE)) {
    if (atTargetMatchesUin(match[1], uin)) return true;
  }
  return false;
}
