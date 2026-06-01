import type { Message } from './message.js';
import type { MessageElement } from './types.js';

function replySegmentId(seg: MessageElement): string | undefined {
  if (seg.type !== 'reply' || !seg.data || typeof seg.data !== 'object') return undefined;
  const data = seg.data as Record<string, unknown>;
  const raw = data.message_id ?? data.id;
  if (raw == null) return undefined;
  const id = String(raw).trim();
  return id || undefined;
}

/** 从 segments 解析首个 reply 的 ID */
export function quoteIdFromContent(content: MessageElement[]): string | undefined {
  if (!content?.length) return undefined;
  for (const seg of content) {
    const id = replySegmentId(seg);
    if (id) return id;
  }
  return undefined;
}

/** icqq raw_message / OneBot CQ 中的 reply id（$content 未含 reply 段时兜底） */
export function quoteIdFromRaw(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const icqq = raw.match(/\[reply:([^\]]+)\]/i);
  if (icqq?.[1]?.trim()) return icqq[1].trim();
  const cq = raw.match(/\[CQ:reply[^\]]*(?:,|^)id=([^\],&\]]+)/i);
  if (cq?.[1]?.trim()) return cq[1].trim();
  return undefined;
}

/** 无 $quote_id 时从 $content / $raw 回填 */
export function syncQuoteId(message: Message<any>): void {
  if (message.$quote_id) return;
  const id =
    quoteIdFromContent(message.$content) ?? quoteIdFromRaw(message.$raw);
  if (id) message.$quote_id = id;
}

/** 将 reply 段的 id / message_id 与 $quote_id 对齐 */
export function alignReplySegments(content: MessageElement[], quoteId?: string): void {
  const id = quoteId ?? quoteIdFromContent(content);
  if (!id) return;
  for (const seg of content) {
    if (seg.type !== 'reply' || !seg.data || typeof seg.data !== 'object') continue;
    const data = seg.data as Record<string, unknown>;
    data.id = id;
    data.message_id = id;
  }
}
