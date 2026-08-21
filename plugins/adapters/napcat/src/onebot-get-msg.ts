export interface QuotedMessagePayload {
  messageId: string;
  sender?: { id: string; name: string };
  content: Array<{ type: string; data?: Record<string, unknown> }>;
  raw?: string;
  time?: number;
}

export function parseOneBotGetMsgResponse(
  messageId: string,
  data: unknown,
): QuotedMessagePayload {
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  let content: QuotedMessagePayload['content'] = [];
  if (Array.isArray(record.message)) {
    content = record.message as QuotedMessagePayload['content'];
  } else if (typeof record.raw_message === 'string' && record.raw_message) {
    content = [{ type: 'text', data: { text: record.raw_message } }];
  }

  const senderRaw = record.sender;
  let sender: QuotedMessagePayload['sender'];
  if (senderRaw && typeof senderRaw === 'object') {
    const s = senderRaw as Record<string, unknown>;
    sender = {
      id: String(s.user_id ?? ''),
      name: String(s.nickname ?? s.card ?? ''),
    };
  }

  return {
    messageId,
    sender,
    content,
    raw: typeof record.raw_message === 'string' ? record.raw_message : undefined,
    time: typeof record.time === 'number' ? record.time : undefined,
  };
}

export function createNapCatContentPort(
  callApi: (action: string, params?: Record<string, unknown>) => Promise<unknown>,
): EndpointContentPort {
  return Object.freeze({
    async resolve(reference: ConversationReference, context: EndpointContentResolveContext) {
      try {
        context.signal.throwIfAborted();
        if (reference.kind === 'media') {
          return reference.media.kind === 'file'
            ? Object.freeze({ status: 'unsupported' as const, code: 'napcat_opaque_media_requires_platform_file_metadata' })
            : Object.freeze({ status: 'resolved' as const, reference, value: reference.media });
        }
        if (reference.kind === 'message') {
          const parsed = parseOneBotGetMsgResponse(reference.message.id, await callApi('get_msg', { message_id: reference.message.id }));
          context.signal.throwIfAborted();
          const value: ConversationMessage = Object.freeze({
            ref: reference.message,
            ...(parsed.sender?.id ? { actor: Object.freeze({ id: parsed.sender.id, ...(parsed.sender.name ? { displayName: parsed.sender.name } : {}) }) } : {}),
            segments: canonicalSegments(parsed.content),
            timestamp: toMillis(parsed.time),
          });
          return Object.freeze({ status: 'resolved' as const, reference, value });
        }
        const raw = await callApi('get_forward_msg', { message_id: reference.forwardId, id: reference.forwardId }) as Record<string, unknown>;
        context.signal.throwIfAborted();
        const nodes = Array.isArray(raw.messages) ? raw.messages.slice(0, context.maxEntries) : [];
        const value: readonly ForwardEntry[] = Object.freeze(nodes.map((node) => {
          const row = node as Record<string, unknown>;
          const sender = row.sender as Record<string, unknown> | undefined;
          return Object.freeze({
            ...(sender?.user_id != null ? { actor: Object.freeze({ id: String(sender.user_id), ...(sender.nickname ? { displayName: String(sender.nickname) } : {}) }) } : {}),
            segments: canonicalSegments(Array.isArray(row.content) ? row.content as never[] : []),
            timestamp: toMillis(row.time),
          });
        }));
        return Object.freeze({ status: 'resolved' as const, reference, value });
      } catch (error) {
        if (context.signal.aborted) return Object.freeze({ status: 'expired' as const, code: 'turn_aborted' });
        return Object.freeze({ status: 'failed' as const, code: 'napcat_content_resolution_failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}

function canonicalSegments(content: Array<{ type: string; data?: Record<string, unknown> }>) {
  return Object.freeze(content.map((segment) => Object.freeze({
    type: segment.type,
    data: Object.freeze(segment.data ?? {}),
  })));
}

function toMillis(value: unknown): number {
  const time = Number(value);
  return Number.isFinite(time) ? (time < 10_000_000_000 ? time * 1000 : time) : Date.now();
}
import type { EndpointContentPort, EndpointContentResolveContext } from 'zhin.js/adapter';
import type { ConversationMessage, ConversationReference, ForwardEntry } from '@zhin.js/im-contract';
