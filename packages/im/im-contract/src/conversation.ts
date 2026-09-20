import type { ActorRef, ConversationRef, MessageRef } from './identity.js';
import type { ForwardEntry, MediaRef, Segment } from './segment.js';

export interface ConversationMessage {
  readonly ref: MessageRef;
  readonly actor?: ActorRef;
  readonly segments: readonly Segment[];
  readonly timestamp: number;
  readonly replyTo?: MessageRef;
}

export type ConversationReference =
  | Readonly<{ kind: 'message'; message: MessageRef }>
  | Readonly<{ kind: 'forward'; conversation: ConversationRef; forwardId: string }>
  | Readonly<{ kind: 'media'; conversation: ConversationRef; media: MediaRef }>;

export type ConversationResolution =
  | Readonly<{ status: 'resolved'; reference: ConversationReference; value: ConversationMessage | readonly ForwardEntry[] | MediaRef }>
  | Readonly<{ status: 'not_found' | 'unsupported' | 'forbidden' | 'expired' | 'failed'; code: string; message?: string }>;

interface ConversationEventBase {
  readonly eventId: string;
  readonly conversation: ConversationRef;
  readonly timestamp: number;
}

export type ConversationEvent =
  | (ConversationEventBase & Readonly<{ type: 'message.created'; message: ConversationMessage }>)
  | (ConversationEventBase & Readonly<{ type: 'message.recalled'; message: MessageRef; actor?: ActorRef; operator?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'message.reaction_changed'; message: MessageRef; actor?: ActorRef; reaction: string; operation: 'added' | 'removed' }>)
  | (ConversationEventBase & Readonly<{ type: 'conversation.poked'; actor?: ActorRef; target?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.joined'; member: ActorRef; actor?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.left'; member: ActorRef; actor?: ActorRef; reason?: 'left' | 'removed' }>)
  | (ConversationEventBase & Readonly<{ type: 'member.muted'; member: ActorRef; actor?: ActorRef; durationSeconds: number }>)
  | (ConversationEventBase & Readonly<{ type: 'member.unmuted'; member: ActorRef; actor?: ActorRef }>)
  | (ConversationEventBase & Readonly<{ type: 'member.role_changed'; member: ActorRef; actor?: ActorRef; role: string; enabled: boolean }>);

export interface SequencedConversationEvent {
  readonly sequence: number;
  readonly event: ConversationEvent;
}

/** AI-neutral, explicitly untrusted projection of conversation facts. */
export interface ConversationContextBlock {
  readonly kind: 'conversation_event';
  readonly sequence: number;
  readonly eventType: ConversationEvent['type'];
  readonly text: string;
}
