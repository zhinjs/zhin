import { QUOTE_INLINE_MAX_CHARS, type ConversationQuote } from '@zhin.js/ai';
import type { TurnIngress, TurnReference } from '../turn/turn-ingress.js';

/** ADR 0043 §4: the quoted message must not delay the turn; an unresolved quote falls back to its id. */
export const TURN_QUOTE_RESOLVE_TIMEOUT_MS = 3000;

interface SegmentLike {
  readonly type?: unknown;
  readonly data?: Readonly<Record<string, unknown>>;
}

interface ActorLike { readonly id?: unknown; readonly displayName?: unknown }

interface Summary { text: string; truncated: boolean }

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function duration(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? ` ${Math.round(value)}s` : '';
}

/** Placeholders for media; text and mentions verbatim; a forward expands one level. */
function summarizeSegments(segments: readonly SegmentLike[], nested: boolean): Summary {
  const parts: string[] = [];
  let truncated = false;
  for (const segment of segments) {
    const data = segment.data ?? {};
    switch (segment.type) {
      case 'text': { const text = str(data.text); if (text) parts.push(text); break; }
      case 'mention': parts.push(`@${str(data.name) ?? str(data.target) ?? ''}`.trim()); break;
      case 'image': parts.push('[图片]'); break;
      case 'audio': parts.push(`[语音${duration(data.duration)}]`); break;
      case 'video': parts.push(`[视频${duration(data.duration)}]`); break;
      case 'file': parts.push(`[文件${str(data.name) ? ` ${str(data.name)}` : ''}]`); break;
      case 'face': case 'emoji': case 'sticker': parts.push('[表情]'); break;
      case 'share': parts.push(`[分享${str(data.title) ? ` ${str(data.title)}` : ''}]`); break;
      case 'reply': break;
      case 'forward': {
        const entries = Array.isArray(data.entries) ? data.entries as Array<{ actor?: ActorLike; segments?: SegmentLike[] }> : [];
        if (nested || entries.length === 0) {
          parts.push(`[转发${str(data.title) ? ` ${str(data.title)}` : ''}]`);
          truncated = true;
          break;
        }
        const lines = entries.map((entry) => {
          const inner = summarizeSegments(entry.segments ?? [], true);
          if (inner.truncated) truncated = true;
          const who = str(entry.actor?.displayName) ?? str(entry.actor?.id);
          return who ? `${who}: ${inner.text}` : inner.text;
        });
        parts.push(`[转发${str(data.title) ? ` ${str(data.title)}` : ''}] ${lines.join(' | ')}`);
        break;
      }
      default: if (typeof segment.type === 'string') parts.push(`[${segment.type}]`);
    }
  }
  return { text: parts.join(' ').replace(/\s+/gu, ' ').trim(), truncated };
}

function clip(text: string): Summary {
  const chars = Array.from(text.replace(/…\[truncated\]/gu, '…'));
  return chars.length > QUOTE_INLINE_MAX_CHARS
    ? { text: `${chars.slice(0, QUOTE_INLINE_MAX_CHARS - 1).join('')}…`, truncated: true }
    : { text: chars.join(''), truncated: false };
}

/** Turns a resolved `ConversationMessage` into the structured quote the history stores. */
export function summarizeQuotedMessage(id: string, value: unknown, truncatedByPort = false): ConversationQuote {
  const message = value && typeof value === 'object' ? value as { actor?: ActorLike; segments?: SegmentLike[]; timestamp?: unknown } : undefined;
  if (!message || !Array.isArray(message.segments)) return { id };
  const summary = summarizeSegments(message.segments, false);
  const clipped = clip(summary.text);
  const senderId = str(message.actor?.id);
  return {
    id,
    ...(senderId ? { senderId } : {}),
    ...(typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) && message.timestamp > 0 ? { timestamp: message.timestamp } : {}),
    ...(clipped.text ? { text: clipped.text } : {}),
    ...(truncatedByPort || summary.truncated || clipped.truncated ? { truncated: true } : {}),
  };
}

export function quotedMessageReference(turn: TurnIngress): TurnReference | undefined {
  return turn.input.references?.find(reference => reference.kind === 'message');
}

/**
 * Resolves the message the inbound message replies to, from the trusted reference the ingress built
 * (never from body text). Resolution failure keeps the id so `reply_to` still works inside the window.
 */
export async function resolveTurnQuote(turn: TurnIngress): Promise<ConversationQuote | undefined> {
  const reference = quotedMessageReference(turn);
  if (!reference) return undefined;
  const port = turn.ports.references;
  if (!port) return { id: reference.sourceId };
  try {
    const signal = AbortSignal.any([turn.signal, AbortSignal.timeout(TURN_QUOTE_RESOLVE_TIMEOUT_MS)]);
    const result = await port.resolve(reference.key, { depth: 1, maxEntries: 8, maxChars: 2000 }, signal);
    if (result.status !== 'resolved') return { id: reference.sourceId };
    return summarizeQuotedMessage(reference.sourceId, result.content, result.truncated === true);
  } catch {
    if (turn.signal.aborted) throw turn.signal.reason;
    return { id: reference.sourceId };
  }
}
