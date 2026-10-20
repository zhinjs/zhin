/**
 * Message enrich — inbound authorization snapshots and synthetic communication context.
 */
import type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract';
import type {
  Message,
  MessageSenderRef,
  Segment,
  SendContent,
} from '../plugin-runtime/im/contracts.js';
import type { SenderRole } from './roles.js';
import { segmentsToPlainText } from './segment-contract/text.js';

/** Agent turns may attach host-owned metadata to the canonical runtime message. */
export type AgentTurnMessage = Message<{ extra?: Record<string, unknown> }>;

export function senderRolesFromMessage(message: Message): readonly SenderRole[] {
  const roles = message.sender?.roles?.filter(
    (role): role is SenderRole => role === 'master' || role === 'trusted' || role === 'user',
  );
  return roles?.length ? roles : ['user'];
}

export interface SyntheticMessageInput {
  conversation: ConversationRef;
  sender?: MessageSenderRef;
  content?: string;
  segments?: readonly Segment[];
  messageId?: string;
  generation?: number;
  endpointId?: string;
  clientAdapter?: string;
  reply?: (content: SendContent) => Promise<DeliveryReceipt>;
  extra?: Record<string, unknown>;
}

/** Construct a canonical Message for cron, subagent, and mission turns without live ingress. */
export function createSyntheticMessage(input: SyntheticMessageInput): AgentTurnMessage {
  const messageId = input.messageId ?? `synthetic:${Date.now()}`;
  const unsupportedReply = async (): Promise<DeliveryReceipt> => Object.freeze({
    status: 'unsupported',
    failure: Object.freeze({
      code: 'synthetic_reply_unavailable',
      message: 'Synthetic Message has no outbound delivery port',
      retryable: false,
    }),
  });
  const reply = input.reply ?? unsupportedReply;
  const segments = input.segments ? Object.freeze([...input.segments]) : undefined;
  const content = segments ? segmentsToPlainText(segments) : (input.content ?? '');
  return Object.freeze({
    conversation: input.conversation,
    content,
    generation: input.generation ?? 0,
    metadata: Object.freeze({}),
    segments,
    sender: input.sender,
    message: Object.freeze({ conversation: input.conversation, id: messageId }),
    endpointId: input.endpointId,
    clientAdapter: input.clientAdapter,
    id: messageId,
    extra: input.extra,
    get $client(): unknown {
      throw new Error('Synthetic Message has no Endpoint Client context');
    },
    $reply: reply,
    $replyFrom: () => unsupportedReply(),
    $sendTo: () => unsupportedReply(),
    $replyToPrivate: () => unsupportedReply(),
    $replyToGroup: () => unsupportedReply(),
    $replyToChannel: () => unsupportedReply(),
  });
}

/** Read a canonical communication message from an AI hook context. */
export function commMessageFromHookContext(context: Record<string, unknown>): Message | undefined {
  const raw = context.commMessage;
  if (raw && typeof raw === 'object' && 'conversation' in raw && 'content' in raw) {
    return raw as Message;
  }
  return undefined;
}

/** Resolve tool context injection keys from the canonical Message contract. */
export function resolveContextKey(message: Message, key: string): unknown {
  switch (key) {
    case 'platform':
      return message.clientAdapter ?? message.conversation.endpoint.adapter;
    case 'endpointKey':
      return message.endpointId ?? message.conversation.endpoint.id;
    case 'messageId':
      return message.id;
    case 'sceneId':
      return message.conversation.id ?? message.sender?.id;
    case 'senderId':
      return message.sender?.id;
    case 'scope':
      return message.conversation.kind;
    default: {
      if (key in message) return (message as unknown as Record<string, unknown>)[key];
      return (message as AgentTurnMessage).extra?.[key];
    }
  }
}
