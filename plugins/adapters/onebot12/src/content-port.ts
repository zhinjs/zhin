import type { EndpointContentPort, EndpointContentResolveContext } from 'zhin.js/adapter';
import type { ConversationMessage, ConversationReference } from '@zhin.js/im-contract';

type CallApi = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

export function createOneBot12ContentPort(callApi: CallApi): EndpointContentPort {
  return Object.freeze({
    async resolve(reference: ConversationReference, context: EndpointContentResolveContext) {
      try {
        context.signal.throwIfAborted();
        if (reference.kind === 'forward') {
          return Object.freeze({ status: 'unsupported' as const, code: 'onebot12_forward_lookup_not_standardized' });
        }
        if (reference.kind === 'media') {
          return reference.media.kind === 'file'
            ? Object.freeze({ status: 'unsupported' as const, code: 'onebot12_opaque_media' })
            : Object.freeze({ status: 'resolved' as const, reference, value: reference.media });
        }
        const row = await callApi('get_message', { message_id: reference.message.id }) as Record<string, unknown>;
        context.signal.throwIfAborted();
        const message = (row.message && typeof row.message === 'object' ? row.message : row) as Record<string, unknown>;
        const segments = normalizeSegments(message.message ?? message.content);
        const value: ConversationMessage = Object.freeze({
          ref: reference.message,
          ...(message.user_id != null ? { actor: Object.freeze({ id: String(message.user_id) }) } : {}),
          segments,
          timestamp: toMillis(message.time),
        });
        return Object.freeze({ status: 'resolved' as const, reference, value });
      } catch (error) {
        if (context.signal.aborted) return Object.freeze({ status: 'expired' as const, code: 'turn_aborted' });
        return Object.freeze({ status: 'failed' as const, code: 'onebot12_content_resolution_failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}

function normalizeSegments(value: unknown) {
  if (!Array.isArray(value)) return Object.freeze([{ type: 'text', data: Object.freeze({ text: String(value ?? '') }) }]);
  return Object.freeze(value.map((item) => {
    const row = item as Record<string, unknown>;
    return Object.freeze({ type: String(row.type ?? 'text'), data: Object.freeze((row.data ?? {}) as Record<string, unknown>) });
  }));
}

function toMillis(value: unknown): number {
  const time = Number(value);
  return Number.isFinite(time) ? (time < 10_000_000_000 ? time * 1000 : time) : Date.now();
}
