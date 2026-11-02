import type { WebClient } from '@slack/web-api';
import type { EndpointMessageStream, EndpointStreamRequest, EndpointStreamAcknowledgement } from 'zhin.js/adapter';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createSlackNativeStream } from './native-stream.js';
import { formatOutboundWire } from './protocol.js';
import { formatSlackMessageRef, parseSlackMessageRef } from './slack-message-ref.js';

export function supportsSlackReplyStream(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean {
  const event = request.source?.event as { team_id?: unknown } | undefined;
  // A future reply prefix may select a thread; recipient authority cannot be supplied by the model.
  return request.conversation.kind === 'private'
    || Boolean(typeof event?.team_id === 'string' && event.team_id && request.source?.senderId);
}

export function openSlackReplyStream(client: WebClient, request: EndpointStreamRequest,
  onMessage: (ts: string) => void): EndpointMessageStream | undefined {
  if (!supportsSlackReplyStream(request)) return undefined;
  // A new physical message cannot inherit the previous native Markdown renderer state.
  if (request.format === 'markdown' && request.continuation) return undefined;
  const prefix = request.prefix ?? [];
  if (prefix.some(segment => segment.type !== 'reply' && segment.type !== 'mention')) return undefined;
  const wire = formatOutboundWire(prefix.length ? prefix : '');
  const replyTo = wire.replyTo ?? request.continuation?.replyTo;
  const quoted = replyTo ? parseSlackMessageRef(replyTo) : null;
  if (quoted && quoted.channel !== request.conversation.id) return undefined;
  const threadTs = request.conversation.threadId ?? quoted?.ts ?? replyTo;
  // Ordinary channel replies must not move into a new thread just to gain streaming.
  if (!threadTs) return undefined;
  const event = request.source?.event as { team_id?: unknown } | undefined;
  const teamId = typeof event?.team_id === 'string' ? event.team_id : undefined;
  const senderId = request.source?.senderId;
  const native = createSlackNativeStream(client.chat, {
    channel: request.conversation.id, thread_ts: threadTs,
    ...(request.conversation.kind !== 'private' ? { recipient_team_id: teamId, recipient_user_id: senderId } : {}),
  }, request.signal);
  let acceptedText = '';
  let cancelled = false;
  let finished = false;
  let exhausted = false;
  let lastAcknowledgement: EndpointStreamAcknowledgement | undefined;
  const acknowledge = (): EndpointStreamAcknowledgement => lastAcknowledgement = Object.freeze({
    status: native.messageTs ? 'sent' : 'buffered',
    ...(native.messageTs ? { messageId: formatSlackMessageRef(request.conversation.id, native.messageTs) } : {}),
    acceptedText,
    ...(exhausted ? { exhausted: true } : {}),
  });
  const write = async (text: string) => {
    if (cancelled) throw new EndpointDeliveryError('stream_cancelled', 'Slack stream was cancelled', 'not_sent');
    if (finished) return acknowledge();
    if (!text.startsWith(acceptedText)) throw new EndpointDeliveryError('stream_rewrite', 'A confirmed reply prefix cannot change', 'not_sent');
    if (native.finalizedByPlatform) { exhausted = true; return acknowledge(); }
    let next = text;
    if (wire.text.length + next.length > 12_000) {
      exhausted = true;
      if (request.format === 'markdown') {
        if (!acceptedText) throw new EndpointDeliveryError('stream_capacity', 'Slack Markdown has no confirmed boundary within its container capacity', 'not_sent');
        return acknowledge();
      }
      next = next.slice(0, Math.max(0, 12_000 - wire.text.length));
      if (/[\uD800-\uDBFF]$/.test(next)) next = next.slice(0, -1);
    }
    if (next === acceptedText) return acknowledge();
    const delta = (native.messageTs ? '' : wire.text) + next.slice(acceptedText.length);
    // Fixed chunks mode allows complete rich blocks without switching Slack's wire mode.
    let ts: string;
    try { ts = await native.append({ chunks: [{ type: 'markdown_text', text: delta }] }); }
    catch (error) {
      if (!native.finalizedByPlatform) throw error;
      exhausted = true;
      return acknowledge();
    }
    acceptedText = next; onMessage(ts);
    return acknowledge();
  };
  return {
    get lastAcknowledgement() { return lastAcknowledgement; },
    write,
    async finish(text) {
      if (finished) return acknowledge();
      await write(text);
      if (cancelled) throw new EndpointDeliveryError('stream_cancelled', 'Slack stream was cancelled', 'not_sent');
      await native.stop(); finished = true;
      if (native.finalizedByPlatform) exhausted = true;
      return acknowledge();
    },
    cancel() { cancelled = true; },
  };
}
