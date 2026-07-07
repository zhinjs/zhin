import type { Message } from './message.js';
import type { MessageElement } from './types.js';

const MAX_RAW_QUOTE_SCAN = 64_000;

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

function extractBracketTag(raw: string, tag: string): string | undefined {
  const open = `[${tag}:`;
  const idx = raw.toLowerCase().indexOf(open.toLowerCase());
  if (idx === -1) return undefined;
  const close = raw.indexOf(']', idx + open.length);
  if (close === -1) return undefined;
  const id = raw.slice(idx + open.length, close).trim();
  return id || undefined;
}

function extractCqReplyId(raw: string): string | undefined {
  const marker = '[cq:reply';
  const lower = raw.toLowerCase();
  let search = 0;
  while (search < raw.length) {
    const idx = lower.indexOf(marker, search);
    if (idx === -1) return undefined;
    const close = raw.indexOf(']', idx);
    if (close === -1) return undefined;
    const segment = raw.slice(idx, close + 1);
    const idIdx = segment.toLowerCase().indexOf('id=');
    if (idIdx !== -1) {
      let start = idIdx + 3;
      while (start < segment.length && /[,\s]/.test(segment[start])) start++;
      let end = start;
      while (end < segment.length && segment[end] !== ',' && segment[end] !== ']' && segment[end] !== '&') {
        end++;
      }
      const id = segment.slice(start, end).trim();
      if (id) return id;
    }
    search = close + 1;
  }
  return undefined;
}

/** icqq raw_message / OneBot CQ 中的 reply id（$content 未含 reply 段时兜底） */
export function quoteIdFromRaw(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const text = raw.length > MAX_RAW_QUOTE_SCAN ? raw.slice(0, MAX_RAW_QUOTE_SCAN) : raw;
  return extractBracketTag(text, 'reply') ?? extractCqReplyId(text);
}

/** 无 $quote_id 时从 $content / $raw 回填 */
export function syncQuoteId(message: Message<any>): void {
  if (message.$quote_id) return;
  const id =
    quoteIdFromContent(message.$content) ?? quoteIdFromRaw(message.$raw);
  if (id) message.$quote_id = id;
}

/** 将 reply 段与 $quote_id 对齐（canonical 仅保留 message_id） */
export function alignReplySegments(content: MessageElement[], quoteId?: string): void {
  const id = quoteId ?? quoteIdFromContent(content);
  if (!id) return;
  for (const seg of content) {
    if (seg.type !== 'reply' || !seg.data || typeof seg.data !== 'object') continue;
    const data = seg.data as Record<string, unknown>;
    data.message_id = id;
    delete data.id;
  }
}
