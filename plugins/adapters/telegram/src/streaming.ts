import { randomInt } from 'node:crypto';
import type { EndpointMessageStream, EndpointStreamAcknowledgement, EndpointStreaming, EndpointStreamRequest } from 'zhin.js/adapter';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { formatOutboundPlan, type TelegramWireSegment } from './protocol.js';
import { escapeTelegramHtml } from './markdown-to-html.js';
import { sliceTelegramMarkdown } from './stream-markdown.js';
import type { TelegramClientApi } from './telegram-client.js';

function supportsTelegramStream(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean {
  return request.conversation.kind === 'private' && !request.conversation.parent;
}

/** Drafts are previews; only finish performs a persistent send. */
export function createTelegramStreaming(getClient: () => Pick<TelegramClientApi, 'callApi'>, minIntervalMs = 500): EndpointStreaming {
  return {
    mode: 'draft',
    minIntervalMs,
    supports: supportsTelegramStream,
    open(request): EndpointMessageStream | undefined {
      if (!supportsTelegramStream(request)) return undefined;
      if (request.prefix?.some(segment => segment.type !== 'reply' && segment.type !== 'mention')) return undefined;
      const prefix: TelegramWireSegment[] = (request.prefix ?? []).map(segment => segment.type === 'mention'
        ? { type: 'at', data: { id: 'target' in segment.data ? segment.data.target : undefined,
          name: 'name' in segment.data ? segment.data.name : undefined } }
        : { type: segment.type, data: { ...segment.data } });
      const draftId = randomInt(1, 2_147_483_647);
      const cancellation = new AbortController();
      const signal = request.signal ? AbortSignal.any([request.signal, cancellation.signal]) : cancellation.signal;
      const threadId = request.conversation.threadId === undefined ? undefined : Number(request.conversation.threadId);
      if (threadId !== undefined && (!Number.isSafeInteger(threadId) || threadId <= 0)) {
        throw new EndpointDeliveryError('invalid_payload', 'Telegram topic id must be a positive integer', 'not_sent');
      }
      let acceptedText = '';
      let messageId: string | undefined;
      let exhausted = false;
      let contentUnavailable = false;
      let confirmed: { readonly source: string; readonly params: Record<string, unknown> & { readonly text: string }; readonly exhausted: boolean } | undefined;
      let failure: unknown;
      let completion: Promise<EndpointStreamAcknowledgement> | undefined;
      const acknowledgement = (): EndpointStreamAcknowledgement => ({
        status: messageId ? 'sent' : acceptedText ? 'preview' : 'buffered', acceptedText,
        ...(messageId ? { messageId } : {}),
        ...(exhausted ? { exhausted: true as const } : {}),
        ...(contentUnavailable ? { contentUnavailable: true as const } : {}),
      });
      const prepare = (text: string) => {
        const mentionText = prefix.map(segment => segment.type === 'at' && segment.data?.id
          ? `@${segment.data.name || segment.data.id}` : '').join('');
        const mentionLength = Array.from(mentionText).length;
        const capacity = 4096 - mentionLength;
        if (capacity <= 0) throw new EndpointDeliveryError('stream_capacity', 'Telegram prefix exceeds its text container', 'not_sent');
        const markdown = request.format === 'markdown'
          ? sliceTelegramMarkdown(text, request.continuation?.precedingText ?? '', capacity) : undefined;
        const source = markdown?.acceptedText ?? Array.from(text).slice(0, capacity).join('');
        const plan = formatOutboundPlan(request.conversation.id, [...prefix, request.format === 'markdown'
          ? { type: 'markdown', data: { content: source } }
          : { type: 'text', data: { text: source } }]);
        const action = plan.actions[0];
        if (plan.actions.length !== 1 || action?.method !== 'sendMessage') {
          throw new EndpointDeliveryError('unsupported_operation', 'Telegram draft requires one text container', 'not_sent');
        }
        const params = { ...action.params,
          ...(markdown ? { text: escapeTelegramHtml(mentionText) + markdown.html } : {}),
          ...(threadId !== undefined ? { message_thread_id: threadId } : {}) };
        return { source, params, exhausted: markdown?.exhausted ?? (source.length < text.length || Array.from(params.text).length === 4096) };
      };
      const send = async (text: string, final: boolean): Promise<EndpointStreamAcknowledgement> => {
        if (failure) throw failure;
        if (signal.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Telegram draft cancelled', 'not_sent');
        if (!text.startsWith(acceptedText)) throw new EndpointDeliveryError('invalid_payload', 'Telegram draft cannot replace its accepted source prefix', 'not_sent');
        if (!text.trim() || (!final && text === acceptedText)) return acknowledgement();
        const next = final && text === acceptedText && confirmed ? confirmed : prepare(text);
        const { source, params } = next;
        if (!final && source === acceptedText) return acknowledgement();
        if (!params.text) return acknowledgement();
        try {
          if (final) {
            const result = await getClient().callApi<{ message_id?: number }>('sendMessage', params, signal);
            if (!Number.isSafeInteger(result?.message_id) || result.message_id! <= 0) {
              throw new EndpointDeliveryError('delivery_unconfirmed', 'Telegram final send returned no valid message_id', 'unknown');
            }
            messageId = String(result.message_id);
          } else {
            const { reply_parameters: _reply, ...draftParams } = params;
            const result = await getClient().callApi<unknown>('sendMessageDraft', { ...draftParams, draft_id: draftId }, signal);
            if (result !== true) throw new EndpointDeliveryError('delivery_unconfirmed', 'Telegram draft response is unconfirmed', 'unknown');
          }
          acceptedText = source;
          // A temporary Markdown preview can still reinterpret an unfinished fence/link.
          // Rollover persists this container, so only the final source may trigger it.
          exhausted = next.exhausted && (final || request.format !== 'markdown');
          contentUnavailable = request.format === 'markdown'
            && (Boolean(request.continuation?.precedingText) || exhausted || source.length < text.length);
          confirmed = next;
          return acknowledgement();
        } catch (error) {
          failure = error;
          throw error;
        }
      };
      return {
        write: text => completion
          ? Promise.reject(new EndpointDeliveryError('stream_closed', 'Telegram draft is finishing', 'not_sent'))
          : send(text, false),
        finish: text => completion ??= send(text, true),
        cancel: () => { cancellation.abort(); },
      };
    },
  };
}
