import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { EndpointMessageStream, EndpointStreamRequest, EndpointStreamAcknowledgement } from 'zhin.js/adapter';
import type { LarkApiResponse } from './protocol.js';

export interface LarkStreamRequestOptions {
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly body: Record<string, unknown>;
  readonly signal?: AbortSignal;
}
type Request = (path: string, options: LarkStreamRequestOptions) => Promise<LarkApiResponse>;

export function supportsLarkReplyStream(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean {
  return !request.conversation.threadId && !request.conversation.parent;
}

/** CardKit text updates use cumulative content and one sequence across content/settings. */
export function openLarkReplyStream(request: EndpointStreamRequest, send: Request): EndpointMessageStream | undefined {
  const prefix = request.prefix ?? [];
  if (prefix.some(segment => segment.type !== 'reply' && segment.type !== 'mention')
    || !supportsLarkReplyStream(request)) return undefined;
  const reply = prefix.find(segment => segment.type === 'reply');
  const replyTo = reply && 'message_id' in reply.data ? reply.data.message_id : undefined;
  const mentions = prefix.filter(segment => segment.type === 'mention').map(segment => {
    const target = String('target' in segment.data ? segment.data.target : '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<at id="${target}"></at>`;
  }).join('');
  let cardId: string | undefined;
  let messageId: string | undefined;
  let sequence = 0;
  let acceptedText = '';
  let cancelled = false;
  let finished = false;
  let exhausted = false;
  let platformClosed = false;
  let failure: unknown;
  const acknowledge = (): EndpointStreamAcknowledgement => ({ status: messageId ? 'sent' : 'buffered',
    ...(messageId ? { messageId } : {}), acceptedText, ...(exhausted ? { exhausted: true } : {}) });
  const bodyText = (text: string) => request.format === 'markdown' ? text : text.replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&');
  const call = (path: string, method: LarkStreamRequestOptions['method'], body: Record<string, unknown>) => {
    if (cancelled) throw new EndpointDeliveryError('stream_cancelled', 'Lark stream was cancelled', 'not_sent');
    request.signal?.throwIfAborted();
    return send(path, { method, body, signal: request.signal });
  };
  const write = async (text: string) => {
    if (failure) throw failure;
    if (cancelled) throw new EndpointDeliveryError('stream_cancelled', 'Lark stream was cancelled', 'not_sent');
    request.signal?.throwIfAborted();
    if (finished) return acknowledge();
    if (!text.startsWith(acceptedText)) throw new EndpointDeliveryError('stream_rewrite', 'A confirmed reply prefix cannot change', 'not_sent');
    if (exhausted) return acknowledge();
    if (text === acceptedText) return acknowledge();
    if (!cardId) {
      try {
        const card = await call('/cardkit/v1/cards', 'POST', { type: 'card_json', data: JSON.stringify({
          schema: '2.0', config: { streaming_mode: true, update_multi: true },
          body: { elements: [
            ...(mentions ? [{ tag: 'markdown', element_id: 'zhin_prefix', content: mentions }] : []),
            { tag: 'markdown', element_id: 'zhin_reply', content: bodyText(text) },
          ] },
        }) });
        cardId = typeof card.data?.card_id === 'string' && card.data.card_id ? card.data.card_id : undefined;
        if (!cardId) throw new Error('CardKit returned no card ID');
      } catch (error) {
        // A card resource may exist, but no chat-message request has been attempted.
        failure = new EndpointDeliveryError('stream_resource_unavailable', 'Lark streaming card could not be prepared', 'not_sent', { cause: error });
        throw failure;
      }
    }
    try {
      if (!messageId) {
        const message = await call(typeof replyTo === 'string' && replyTo
          ? `/im/v1/messages/${encodeURIComponent(replyTo)}/reply` : '/im/v1/messages?receive_id_type=chat_id', 'POST', {
          ...(replyTo ? {} : { receive_id: request.conversation.id }),
          msg_type: 'interactive', content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
        });
        if (typeof message.data?.message_id !== 'string' || !message.data.message_id.trim()) {
          throw new EndpointDeliveryError('delivery_unconfirmed', 'Lark stream returned no message ID', 'unknown');
        }
        messageId = message.data.message_id;
      } else {
        await call(`/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/zhin_reply/content`, 'PUT', {
          content: bodyText(text), sequence: ++sequence,
        });
      }
      acceptedText = text;
      return acknowledge();
    } catch (error) {
      const code = rejectedPlatformCode(error);
      if (messageId && acceptedText && (code === 200850 || code === 200860)) {
        // The rejected update contributed no source. Timeout explicitly closes the
        // prior card; capacity requires closing only its last confirmed contents.
        exhausted = true; platformClosed = code === 200850;
        return acknowledge();
      }
      failure = streamFailure(error); throw failure;
    }
  };
  return {
    write,
    async finish(text) {
      if (finished) return acknowledge();
      await write(text);
      if (cardId && messageId && !platformClosed) {
        try { await call(`/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`, 'PATCH', {
          settings: JSON.stringify({ config: { streaming_mode: false } }), sequence: ++sequence,
        }); } catch (error) {
          if (rejectedPlatformCode(error) === 200850) { platformClosed = true; exhausted = true; }
          else { failure = streamFailure(error); throw failure; }
        }
      }
      finished = true; return acknowledge();
    },
    cancel() { cancelled = true; },
  };
}

function rejectedPlatformCode(error: unknown): number | undefined {
  return error instanceof EndpointDeliveryError && error.disposition === 'rejected' && 'platformCode' in error
    && typeof error.platformCode === 'number' ? error.platformCode : undefined;
}

function streamFailure(error: unknown): EndpointDeliveryError {
  return error instanceof EndpointDeliveryError ? error
    : new EndpointDeliveryError('delivery_unconfirmed', 'Lark stream update outcome is unknown', 'unknown', { cause: error });
}
