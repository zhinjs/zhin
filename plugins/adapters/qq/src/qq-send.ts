/**
 * One QQ outbound send: passive reply when a usable source exists, active message otherwise, with
 * the fallbacks the platform's error codes allow. Shared by the websocket and webhook Endpoints.
 *
 * 1. Each message claims a passive source (explicit reply segment first, else the conversation's
 *    newest usable msg_id / event_id) with its own msg_seq.
 * 2. Source unusable (expired, over the limit, invalid id): mark it and send that message once as
 *    an active message. Never after a timeout: the first request may have been delivered.
 * 3. Markdown not allowed: resend the same message as plain text.
 * 4. Active message refused (no permission, quota, user switched it off): remember the conversation
 *    for a while and fail fast instead of calling the platform again.
 */
import { createEndpointOperation, type EndpointOperation } from 'zhin.js/adapter';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import type { Sendable } from 'qq-official-bot';
import type { QqOutboundElem, QqOutboundMessage } from './outbound.js';
import {
  QQ_ACTIVE_UNAVAILABLE_CODES,
  QQ_MARKDOWN_DENIED_CODES,
  QQ_PASSIVE_SOURCE_CODES,
  type PassiveReplyGrant,
  type QqActiveMessageGate,
  type QqPassiveReplyLedger,
  type QqReplySource,
} from './passive-reply.js';
import { qqDeliveryFailure } from './delivery-error.js';
import { qqOutboundKind } from './protocol.js';
import type { QqBotTransport, QqSendOptions } from './ws.js';

export interface QqSendContext {
  readonly bot: QqBotTransport;
  readonly ledger: QqPassiveReplyLedger;
  readonly activeGate: QqActiveMessageGate;
  readonly log: (fields: Record<string, string | number | undefined>) => void;
}

type Kind = ReturnType<typeof qqOutboundKind>;
interface QqSendExecution extends QqSendContext { readonly operation: EndpointOperation; }
interface QqMessageDispatch {
  readonly kind: Kind;
  readonly id: string;
  readonly message: QqOutboundMessage;
  readonly source?: QqReplySource;
  readonly options?: QqSendOptions;
}
export interface QqMessagesRequest {
  readonly conversation: ConversationRef;
  readonly messages: readonly QqOutboundMessage[];
  readonly signal?: AbortSignal;
}


function elements(message: QqOutboundMessage): Array<string | QqOutboundElem> {
  return Array.isArray(message) ? [...message] : [message as string | QqOutboundElem];
}

/** The reply segment the payload already names, as a passive source. */
export function explicitReplySource(message: QqOutboundMessage): QqReplySource | undefined {
  for (const part of elements(message)) {
    if (typeof part === 'string' || part.type !== 'reply') continue;
    if (typeof part.data.event_id === 'string' && part.data.event_id) return { event_id: part.data.event_id };
    if (typeof part.data.id === 'string' && part.data.id) return { id: part.data.id };
  }
  return undefined;
}

/** Plain-text version of a Markdown message (buttons dropped); undefined when it has no Markdown. */
export function markdownAsText(message: QqOutboundMessage): QqOutboundMessage | undefined {
  const parts = elements(message);
  if (!parts.some(part => typeof part !== 'string' && (part.type === 'markdown' || part.type === 'keyboard' || part.type === 'button'))) return undefined;
  const text = parts.map(part => {
    if (typeof part === 'string') return part;
    if (part.type === 'text') return String(part.data.text ?? '');
    if (part.type === 'markdown') {
      return String(part.data.content ?? '')
        .replace(/!\[[^\]\n]{0,500}\]\(([^)\s]{1,2000})\)/g, '$1')
        .replace(/\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\)/g, '$1 $2')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/(\*\*|__|~~|`)/g, '');
    }
    return '';
  }).join('').trim();
  const kept = parts.filter((part): part is QqOutboundElem => typeof part !== 'string' && (part.type === 'reply' || part.type === 'at'));
  return text ? [...kept, text] : undefined;
}

function dispatch(bot: QqBotTransport, { kind, id, message, source, options }: QqMessageDispatch): Promise<unknown> {
  switch (kind) {
    case 'private': return bot.sendPrivateMessage(id, message as Sendable, source, options);
    case 'group': return bot.sendGroupMessage(id, message as Sendable, source, options);
    case 'channel': return bot.sendGuildMessage(id, message as Sendable, source, options);
    case 'direct':
      if (!bot.sendDirectMessage) throw new Error('QQ direct message not supported by transport');
      return bot.sendDirectMessage(id, message as Sendable, source, options);
  }
}

function platformCode(error: unknown): number | undefined {
  return qqDeliveryFailure(error).diagnostic.platformCode;
}

/** Sends one message, passive if possible; returns the platform result. */
async function sendOne(context: QqSendExecution, { kind, id, message }: QqMessageDispatch): Promise<unknown> {
  const passive = (body: QqOutboundMessage, grant: PassiveReplyGrant) =>
    context.operation.run(() => dispatch(context.bot, { kind, id, message: body, source: grant.source, options: { msgSeq: grant.msgSeq } }));
  const active = async (body: QqOutboundMessage): Promise<unknown> => {
    if (context.activeGate.blocked(kind, id)) {
      throw new EndpointDeliveryError('platform_rejected', 'QQ active messages are unavailable for this conversation', 'not_sent');
    }
    try {
      return await context.operation.run(() => dispatch(context.bot, { kind, id, message: body }));
    } catch (error) {
      const code = platformCode(error);
      if (code !== undefined && QQ_ACTIVE_UNAVAILABLE_CODES.has(code) && context.activeGate.block(kind, id)) {
        context.log({ op: 'qq_active_unavailable', target: `${kind}:${id}`, platformCode: code });
      }
      throw error;
    }
  };
  /** Markdown refused: the same message once more as plain text, under a fresh msg_seq when passive. */
  const asText = (error: unknown, previous: PassiveReplyGrant | undefined): Promise<unknown> => {
    const code = platformCode(error);
    const text = code !== undefined && QQ_MARKDOWN_DENIED_CODES.has(code) ? markdownAsText(message) : undefined;
    if (!text) throw error;
    context.log({ op: 'qq_markdown_denied_as_text', target: `${kind}:${id}`, platformCode: code });
    const retry = previous ? context.ledger.acquire(kind, id, previous.source) : undefined;
    return retry ? passive(text, retry) : active(text);
  };
  const activeOrText = (body: QqOutboundMessage) => active(body).catch((error: unknown) => asText(error, undefined));

  const grant = context.ledger.acquire(kind, id, explicitReplySource(message));
  if (!grant) return activeOrText(message);
  try {
    return await passive(message, grant);
  } catch (error) {
    const code = platformCode(error);
    if (code !== undefined && QQ_PASSIVE_SOURCE_CODES.has(code)) {
      context.ledger.exhaust(kind, id, grant.source);
      context.log({ op: 'qq_passive_source_unusable', target: `${kind}:${id}`, platformCode: code });
      return activeOrText(message);
    }
    // Anything else, including a timeout (outcome unknown), is not retried as an active message.
    return asText(error, grant);
  }
}

/** Sends every message of one delivery in order; returns the last platform result. */
export async function sendQqMessages(context: QqSendContext, { conversation, messages, signal }: QqMessagesRequest): Promise<unknown> {
  const kind = qqOutboundKind(conversation);
  const execution = { ...context, operation: createEndpointOperation({ signal }) };
  let result: unknown;
  for (const message of messages) result = await sendOne(execution, { kind, id: conversation.id, message });
  return result;
}
