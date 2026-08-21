import type { EndpointContentPort, EndpointContentResolveContext } from 'zhin.js/adapter';
import { toCanonicalSegments } from '@zhin.js/core';
import type { ConversationMessage, ConversationReference, ForwardEntry } from '@zhin.js/im-contract';

type CallApi = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

export function createOneBot11ContentPort(callApi: CallApi): EndpointContentPort {
  return Object.freeze({
    async resolve(reference: ConversationReference, context: EndpointContentResolveContext) {
      try {
        context.signal.throwIfAborted();
        if (reference.kind === 'media') {
          return reference.media.kind === 'file'
            ? Object.freeze({ status: 'unsupported' as const, code: 'onebot11_opaque_media' })
            : Object.freeze({ status: 'resolved' as const, reference, value: reference.media });
        }
        if (reference.kind === 'message') {
          const row = await callApi('get_msg', { message_id: reference.message.id }) as Record<string, unknown>;
          context.signal.throwIfAborted();
          const segments = normalizeSegments(row.message ?? row.raw_message);
          const sender = row.sender as Record<string, unknown> | undefined;
          const value: ConversationMessage = Object.freeze({
            ref: reference.message,
            ...(sender?.user_id != null ? { actor: Object.freeze({
              id: String(sender.user_id),
              ...(sender.nickname ? { displayName: String(sender.nickname) } : {}),
            }) } : {}),
            segments,
            timestamp: toMillis(row.time),
          });
          return Object.freeze({ status: 'resolved' as const, reference, value });
        }
        const raw = await callApi('get_forward_msg', { id: reference.forwardId }) as Record<string, unknown>;
        context.signal.throwIfAborted();
        const nodes = Array.isArray(raw.messages) ? raw.messages.slice(0, context.maxEntries) : [];
        const value: readonly ForwardEntry[] = Object.freeze(nodes.map((node) => {
          const row = node as Record<string, unknown>;
          const sender = row.sender as Record<string, unknown> | undefined;
          return Object.freeze({
            ...(sender?.user_id != null ? { actor: Object.freeze({
              id: String(sender.user_id),
              ...(sender.nickname ? { displayName: String(sender.nickname) } : {}),
            }) } : {}),
            timestamp: toMillis(row.time),
            segments: normalizeSegments(row.content ?? row.message),
          });
        }));
        return Object.freeze({ status: 'resolved' as const, reference, value, truncated: nodes.length >= context.maxEntries });
      } catch (error) {
        if (context.signal.aborted) return Object.freeze({ status: 'expired' as const, code: 'turn_aborted' });
        return Object.freeze({ status: 'failed' as const, code: 'onebot11_content_resolution_failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}

function normalizeSegments(value: unknown) {
  if (Array.isArray(value)) return Object.freeze(toCanonicalSegments(value as never));
  return Object.freeze([{ type: 'text', data: Object.freeze({ text: String(value ?? '') }) }]);
}

function toMillis(value: unknown): number {
  const time = Number(value);
  if (!Number.isFinite(time)) return Date.now();
  return time < 10_000_000_000 ? time * 1000 : time;
}
