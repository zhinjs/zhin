import type { ComposedNoticeName } from './side-event/types.js';
import { RuntimeSideEvent, type IncomingSideEvent, type SideEventBase, type EndpointEventContext } from './side-event/base.js';

export type { NoticeKind, ComposedNoticeName } from './side-event/types.js';
export type { SideEventBase, IncomingSideEvent } from './side-event/base.js';
export { composeSideEventName, formatSideEventName, matchesSideEventName, parseSideEventName, sideEventConversation, sideEventSendChannel } from './side-event/base.js';

export interface IncomingNotice extends IncomingSideEvent {
  readonly type: 'notice';
  readonly name: ComposedNoticeName;
  readonly messageId?: string;
  readonly reaction?: string;
  readonly operation?: 'added' | 'removed';
  readonly durationSeconds?: number;
  readonly role?: string;
  readonly enabled?: boolean;
}

export interface NoticeBase extends SideEventBase {
  readonly type: 'notice';
  readonly name: ComposedNoticeName;
  readonly messageId?: string;
  readonly reaction?: string;
  readonly operation?: 'added' | 'removed';
  readonly durationSeconds?: number;
  readonly role?: string;
  readonly enabled?: boolean;
}

export type Notice<T extends object = {}> = NoticeBase & T;

/** @internal Generation-scoped implementation of the public Notice contract. */
export class RuntimeNotice extends RuntimeSideEvent implements NoticeBase {
  declare readonly type: 'notice';
  declare readonly name: ComposedNoticeName;
  readonly messageId?: string;
  readonly reaction?: string;
  readonly operation?: 'added' | 'removed';
  readonly durationSeconds?: number;
  readonly role?: string;
  readonly enabled?: boolean;
  constructor(input: IncomingNotice, context: EndpointEventContext) {
    super(input, context);
    this.messageId = input.messageId;
    this.reaction = input.reaction;
    this.operation = input.operation;
    this.durationSeconds = input.durationSeconds;
    this.role = input.role;
    this.enabled = input.enabled;
    Object.freeze(this);
  }
}

export const Notice = RuntimeNotice;
