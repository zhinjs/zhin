import { createHash } from 'node:crypto';
import type {
  AgentMessage,
  AssistantMessage,
  ConversationActor,
  ConversationQuote,
  UserMessage,
} from '@zhin.js/ai';
import type { TurnContextState } from '../turn/turn-ingress.js';

/**
 * ADR 0041 §4 (amended): the trusted host stores only STRUCTURED participant facts; the header string is
 * rendered at the LLM boundary (`projectParticipantHeaders`). A user message already carries its host-built
 * `actor`, so this only attaches the quoted message (ADR 0043 §4) — `name` is never written.
 */
export function stampUserHeader(user: UserMessage, quote?: ConversationQuote): UserMessage {
  return quote ? { ...user, quote } : user;
}

/** The bot's own facts as a structured actor, from the turn's `contextState.bot`. */
export function assistantActorOf(bot: NonNullable<TurnContextState['bot']> | undefined): ConversationActor | undefined {
  if (!bot?.id) return undefined;
  const name = bot.profile?.values.nickname !== undefined
    ? bot.profile.values.nickname?.trim() : bot.name?.trim();
  return {
    subjectId: bot.id,
    ...(name ? { displayName: name } : {}),
    ...(bot.platformRole ? { roles: [bot.platformRole] } : {}),
    ...(bot.nickname ? { groupNickname: bot.nickname } : {}),
  };
}

/** Marks every assistant message that carries text with the bot's actor; others stay untouched. */
export function stampAssistantHeaders(
  messages: AgentMessage[],
  bot: NonNullable<TurnContextState['bot']> | undefined,
): AgentMessage[] {
  const assistantActor = assistantActorOf(bot);
  if (!assistantActor) return messages;
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const assistant = message as AssistantMessage;
    if (assistant.name !== undefined || assistant.assistantActor !== undefined
      || !assistant.content.some(block => block.type === 'text')) return message;
    return { ...assistant, assistantActor };
  });
}

export interface DeliveredMessageStampInput {
  readonly status?: string;
  readonly messageId?: string;
  readonly messageIds?: readonly (string | null)[];
  readonly messages?: readonly (import('@zhin.js/im-contract').MessageRef | null)[];
  readonly contextRefs?: readonly string[];
  readonly conversationSequence?: number;
  readonly conversationSequences?: readonly (number | null)[];
  readonly conversationKey?: string;
}

/**
 * ADR 0043 §5: once delivery reports the platform id of the bot's reply, the last text-bearing assistant
 * message of the turn carries it, so later quotes of that reply resolve to an alias.
 */
export function stampDeliveredMessageId(
  messages: AgentMessage[],
  messageIdOrOutcome: string | DeliveredMessageStampInput | undefined,
  contextRefs?: readonly string[],
  messageIds?: readonly (string | null)[],
  conversationMeta?: {
    readonly conversationSequence?: number;
    readonly conversationSequences?: readonly (number | null)[];
    readonly conversationKey?: string;
  },
): AgentMessage[] {
  const isObjectInput = typeof messageIdOrOutcome === 'object' && messageIdOrOutcome !== null;
  const resolvedMessageId = isObjectInput ? messageIdOrOutcome.messageId : messageIdOrOutcome;
  const resolvedContextRefs = isObjectInput ? (messageIdOrOutcome.contextRefs ?? contextRefs) : contextRefs;
  const resolvedMessageIds = isObjectInput
    ? (messageIdOrOutcome.messageIds
      ?? messageIdOrOutcome.messages?.map(m => m?.id ?? null)
      ?? messageIds)
    : messageIds;
  const resolvedConversationSequence = isObjectInput
    ? (messageIdOrOutcome.conversationSequence ?? conversationMeta?.conversationSequence)
    : conversationMeta?.conversationSequence;
  const resolvedConversationSequences = isObjectInput
    ? (messageIdOrOutcome.conversationSequences ?? conversationMeta?.conversationSequences)
    : conversationMeta?.conversationSequences;
  const resolvedConversationKey = isObjectInput
    ? (messageIdOrOutcome.conversationKey ?? conversationMeta?.conversationKey)
    : conversationMeta?.conversationKey;

  // Providers do not own delivery provenance, including on intermediate assistant messages.
  let next = messages.map(message => {
    if (
      message.role !== 'assistant'
      || (
        !('contextRefs' in message)
        && !('contextDigest' in message)
        && !('messageIds' in message)
        && !('conversationEventId' in message)
        && !('conversationEventIds' in message)
        && !('conversationKey' in message)
      )
    ) return message;
    const {
      contextRefs: _untrusted,
      contextDigest: _untrustedDigest,
      messageIds: _untrustedIds,
      conversationEventId: _untrustedConvEventId,
      conversationEventIds: _untrustedConvEventIds,
      conversationKey: _untrustedConvKey,
      ...clean
    } = message as AssistantMessage;
    return clean;
  });
  if (next.every((message, index) => message === messages[index])) next = messages;
  const confirmed = resolvedMessageIds?.map(id => typeof id === 'string' && id.trim() ? id : null)
    ?? (resolvedMessageId?.trim() ? [resolvedMessageId] : []);
  const confirmedSeqs = resolvedConversationSequences?.map(seq =>
    typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 ? seq : null,
  ) ?? (typeof resolvedConversationSequence === 'number' && Number.isSafeInteger(resolvedConversationSequence) && resolvedConversationSequence > 0
    ? [resolvedConversationSequence]
    : []);
  const primarySeq = typeof resolvedConversationSequence === 'number' && Number.isSafeInteger(resolvedConversationSequence) && resolvedConversationSequence > 0
    ? resolvedConversationSequence
    : confirmedSeqs.find((seq): seq is number => seq !== null);
  const trimmedKey = resolvedConversationKey?.trim() || undefined;
  if (!confirmed.length && !resolvedContextRefs?.length && primarySeq === undefined && !confirmedSeqs.length && !trimmedKey) return next;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const message = next[i]!;
    if (message.role !== 'assistant') continue;
    const assistant = message as AssistantMessage;
    if (!assistant.content.some(block => block.type === 'text')) continue;
    const stamped = next.slice();
    const firstKnown = confirmed.find((id): id is string => id !== null);
    stamped[i] = {
      ...assistant,
      ...(confirmed.length ? { ...(firstKnown ? { messageId: firstKnown } : {}), messageIds: confirmed } : {}),
      ...(primarySeq !== undefined ? { conversationEventId: primarySeq } : {}),
      ...(confirmedSeqs.length ? { conversationEventIds: confirmedSeqs } : {}),
      ...(trimmedKey ? { conversationKey: trimmedKey } : {}),
      ...(resolvedContextRefs?.length ? {
        contextRefs: [...resolvedContextRefs],
        contextDigest: createHash('sha256').update(JSON.stringify(assistant.content.filter(block => block.type === 'text').map(block => block.text))).digest('hex'),
      } : {}),
    };
    return stamped;
  }
  return next;
}
