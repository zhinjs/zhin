import type { ConversationRef, EndpointRef } from '@zhin.js/im-contract';
import type { ConversationAddress, MessageSenderRef } from '../plugin-runtime/im/contracts.js';

/** Shared Endpoint event data, with no assumption about chat or participants. */
export interface IncomingEndpointEvent {
  readonly id: string;
  readonly type: 'notice' | 'request' | 'system';
  readonly name: string;
  readonly endpointId?: string;
  readonly clientAdapter?: string;
  readonly timestamp: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Identity and lifetime shared by all canonical Endpoint event views. */
export interface EndpointEventBase extends IncomingEndpointEvent {
  readonly endpoint: EndpointRef;
  readonly generation: number;
  readonly $client: unknown;
}

/** Adapter-normalized Notice/Request data. System events do not inherit this contract. */
export interface IncomingSideEvent extends IncomingEndpointEvent {
  readonly type: 'notice' | 'request';
  readonly conversation?: ConversationAddress;
  readonly actor?: MessageSenderRef;
  readonly target?: MessageSenderRef;
}

export interface SideEventBase extends IncomingSideEvent, Omit<EndpointEventBase, 'type'> {
  readonly conversation?: ConversationRef;
}

/** @internal Context captured by one generation-owned ingress operation. */
export interface EndpointEventContext {
  readonly endpoint: EndpointRef;
  readonly generation: number;
  readonly client: () => unknown;
}

/** @internal Endpoint identity/lifetime only; SystemEvent has no chat fields. */
export class RuntimeEndpointEvent implements EndpointEventBase {
  readonly id: string;
  readonly type: IncomingEndpointEvent['type'];
  readonly name: string;
  readonly endpoint: EndpointRef;
  readonly endpointId?: string;
  readonly clientAdapter?: string;
  readonly timestamp: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly generation: number;
  readonly #client: () => unknown;

  constructor(input: IncomingEndpointEvent, context: EndpointEventContext) {
    if (!input.name.startsWith(`${input.type}.`)) {
      throw new TypeError('Event name must belong to its event type');
    }
    this.id = input.id;
    this.type = input.type;
    this.name = input.name;
    this.endpoint = Object.freeze({ ...context.endpoint });
    this.endpointId = input.endpointId;
    this.clientAdapter = input.clientAdapter ?? context.endpoint.adapter;
    this.timestamp = input.timestamp;
    this.metadata = Object.freeze({ ...input.metadata });
    this.generation = context.generation;
    this.#client = context.client;
  }

  get $client(): unknown { return this.#client(); }
}

/** @internal Shared Notice/Request data view. */
export class RuntimeSideEvent extends RuntimeEndpointEvent implements SideEventBase {
  declare readonly type: IncomingSideEvent['type'];
  readonly conversation?: ConversationRef;
  readonly actor?: MessageSenderRef;
  readonly target?: MessageSenderRef;

  constructor(input: IncomingSideEvent, context: EndpointEventContext) {
    super(input, context);
    this.conversation = input.conversation ? Object.freeze({
      ...input.conversation,
      ...(input.conversation.parent ? { parent: Object.freeze({ ...input.conversation.parent }) } : {}),
      endpoint: this.endpoint,
    }) : undefined;
    this.actor = freezeSender(input.actor);
    this.target = freezeSender(input.target);
  }
}

function freezeSender(sender?: MessageSenderRef): MessageSenderRef | undefined {
  return sender ? Object.freeze({
    ...sender,
    ...(sender.roles ? { roles: Object.freeze([...sender.roles]) } : {}),
  }) : undefined;
}

export function composeSideEventName(type: string, sceneType?: string, subType?: string): string {
  return [type, sceneType, subType].filter(Boolean).join('.');
}

/** The full semantic event name is the only event-name authority. */
export function formatSideEventName(event: Pick<IncomingEndpointEvent, 'name'>): string {
  return event.name;
}

export function matchesSideEventName(event: Pick<IncomingEndpointEvent, 'name'>, fullName: string): boolean {
  return event.name === fullName;
}

export function parseSideEventName(fullName: string): { type: string; scene_type?: string; sub_type?: string } {
  const parts = fullName.split('.');
  return { type: parts[0] ?? '', scene_type: parts[1], sub_type: parts.slice(2).join('.') || undefined };
}

/** Map known platform scene domains; non-conversation events have no send target. */
export function sideEventConversation(sceneType: string | undefined, id: string): ConversationAddress | undefined {
  if (!id) return undefined;
  const kind = sceneType === 'friend' ? 'private' : sceneType;
  return kind === 'private' || kind === 'group' || kind === 'channel'
    ? Object.freeze({ kind, id })
    : undefined;
}

export function sideEventSendChannel(event: Pick<IncomingSideEvent, 'conversation'>):
  { id: string; type: 'group' | 'private' | 'channel' } | undefined {
  return event.conversation ? { id: event.conversation.id, type: event.conversation.kind } : undefined;
}
