import type { Bot, PrivateMessageStream } from 'qq-official-bot';
import { createEndpointOperation, type EndpointMessageStream, type EndpointStreaming, type EndpointStreamRequest,
  type EndpointStreamAcknowledgement } from 'zhin.js/adapter';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { qqDeliveryFailure } from './delivery-error.js';
import type { QqPassiveReplyLedger, QqReplySource } from './passive-reply.js';
import { qqOutboundKind, resolveOutboundMessageId } from './protocol.js';
import { qqMarkdownClosing, qqMarkdownContinuation } from './stream-markdown.js';

function supportsQqStream(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean {
  return qqOutboundKind(request.conversation) === 'private';
}

/** C2C native streams share the ordinary passive ledger, source and sequence. */
export function createQqStreaming(getBot: () => Bot, ledger: QqPassiveReplyLedger, minIntervalMs = 500): EndpointStreaming {
  return {
    mode: 'native',
    minIntervalMs,
    supports: supportsQqStream,
    open(request): EndpointMessageStream | undefined {
      if (!supportsQqStream(request)) return undefined;
      // stream_messages has no verified canonical mention/keyboard projection.
      // Keep these combinations on the complete-message codec instead of guessing.
      if (request.prefix?.some(segment => segment.type !== 'reply')) return undefined;
      const precedingText = request.continuation?.precedingText ?? '';
      const opening = request.format === 'markdown' ? qqMarkdownContinuation(precedingText).opening : '';
      const reply = request.prefix?.find(segment => segment.type === 'reply');
      const explicitId = reply && 'message_id' in reply.data ? reply.data.message_id : undefined;
      const preferred: QqReplySource | undefined = typeof explicitId === 'string' && explicitId
        ? { id: explicitId }
        : request.source?.messageId ? { id: request.source.messageId } : undefined;
      const cancellation = new AbortController();
      const signal = request.signal ? AbortSignal.any([request.signal, cancellation.signal]) : cancellation.signal;
      const operation = createEndpointOperation({ signal });
      let native: PrivateMessageStream | undefined;
      let acceptedText = '';
      let messageId: string | undefined;
      let exhausted = false;
      let contentUnavailable = Boolean(opening);
      let openingSent = false;
      let failure: unknown;
      let completion: Promise<EndpointStreamAcknowledgement> | undefined;
      const acknowledgement = (): EndpointStreamAcknowledgement => ({
        status: messageId ? 'sent' : 'buffered', acceptedText, ...(messageId ? { messageId } : {}),
        ...(exhausted ? { exhausted: true as const } : {}),
        ...(contentUnavailable ? { contentUnavailable: true as const } : {}),
      });
      const send = async (text: string, final: boolean): Promise<EndpointStreamAcknowledgement> => {
        if (failure) throw failure;
        if (signal.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'QQ stream cancelled', 'not_sent');
        if (!text.startsWith(acceptedText)) throw new EndpointDeliveryError('invalid_payload', 'QQ stream cannot replace its accepted prefix', 'not_sent');
        if (!final && (text === acceptedText || exhausted)) return acknowledgement();
        if (final && exhausted && text !== acceptedText) throw new EndpointDeliveryError('stream_capacity', 'QQ exhausted stream must finish its accepted prefix', 'not_sent');
        if (!native) {
          if (!text) return acknowledgement();
          const grant = ledger.acquire('private', request.conversation.id, preferred);
          if (!grant) throw new EndpointDeliveryError('unsupported_operation', 'QQ stream has no usable passive reply source', 'not_sent');
          native = getBot().createPrivateStream(request.conversation.id, {
            source: grant.source, msgSeq: grant.msgSeq,
            contentType: request.format, inputMode: 'append',
          });
        }
        try {
          const closing = final && request.format === 'markdown' ? qqMarkdownClosing(precedingText + text) : '';
          // An exhausted container permits only the terminating state frame;
          // no extra formatting characters may exceed its confirmed capacity.
          const suffix = exhausted ? '' : closing;
          const delta = (openingSent ? '' : opening) + text.slice(acceptedText.length) + suffix;
          const result = await operation.run(() => final ? native!.end(delta) : native!.write(delta));
          const id = resolveOutboundMessageId(result);
          messageId = `private-${request.conversation.id}:${id}`;
          acceptedText = text;
          openingSent = true;
          contentUnavailable ||= Boolean(closing);
          // Zero is exhausted regardless of the platform's otherwise unspecified unit.
          exhausted = result.remain_msg_len === 0;
          return acknowledgement();
        } catch (error) {
          failure = qqDeliveryFailure(error).failure;
          throw failure;
        }
      };
      return {
        write: text => completion
          ? Promise.reject(new EndpointDeliveryError('stream_closed', 'QQ stream is finishing', 'not_sent'))
          : send(text, false),
        finish: text => completion ??= send(text, true),
        cancel: () => { cancellation.abort(); },
      };
    },
  };
}
