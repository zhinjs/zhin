import type { ComposedSystemName } from './side-event/types.js';
import { RuntimeEndpointEvent, type IncomingEndpointEvent, type EndpointEventBase, type EndpointEventContext } from './side-event/base.js';

export type { ComposedSystemName, SystemKind } from './side-event/types.js';
export type { IncomingEndpointEvent, EndpointEventBase } from './side-event/base.js';

export interface IncomingSystemEvent extends IncomingEndpointEvent {
  readonly type: 'system';
  readonly name: ComposedSystemName;
}

export interface SystemEventBase extends EndpointEventBase {
  readonly type: 'system';
  readonly name: ComposedSystemName;
}

export type SystemEvent<T extends object = {}> = SystemEventBase & T;

/** @internal Endpoint lifecycle signals do not imply a conversation. */
export class RuntimeSystemEvent extends RuntimeEndpointEvent implements SystemEventBase {
  declare readonly type: 'system';
  declare readonly name: ComposedSystemName;
  constructor(input: IncomingSystemEvent, context: EndpointEventContext) {
    super(input, context);
    Object.freeze(this);
  }
}

export const SystemEvent = RuntimeSystemEvent;
