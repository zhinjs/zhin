import type { MessageSenderRef } from './plugin-runtime/im/contracts.js';
import type { ComposedRequestName } from './side-event/types.js';
import { RuntimeSideEvent, type IncomingSideEvent, type SideEventBase, type EndpointEventContext } from './side-event/base.js';

export type { RequestKind, ComposedRequestName } from './side-event/types.js';

export interface IncomingRequest extends IncomingSideEvent {
  readonly type: 'request';
  readonly name: ComposedRequestName;
  readonly actor: MessageSenderRef;
  readonly comment?: string;
  readonly $approve: (remark?: string) => void | Promise<void>;
  readonly $reject: (reason?: string) => void | Promise<void>;
}

export interface RequestBase extends SideEventBase {
  readonly type: 'request';
  readonly name: ComposedRequestName;
  readonly actor: MessageSenderRef;
  readonly comment?: string;
  readonly $approve: (remark?: string) => Promise<void>;
  readonly $reject: (reason?: string) => Promise<void>;
}

export type Request<T extends object = {}> = RequestBase & T;

/** @internal Actions are bound by the ingress operation, never retained across generations. */
export class RuntimeRequest extends RuntimeSideEvent implements RequestBase {
  declare readonly type: 'request';
  declare readonly name: ComposedRequestName;
  declare readonly actor: MessageSenderRef;
  readonly comment?: string;
  readonly $approve: RequestBase['$approve'];
  readonly $reject: RequestBase['$reject'];

  constructor(input: IncomingRequest, context: EndpointEventContext) {
    super(input, context);
    this.comment = input.comment;
    this.$approve = async (remark) => { await input.$approve(remark); };
    this.$reject = async (reason) => { await input.$reject(reason); };
    Object.freeze(this);
  }
}

export const Request = RuntimeRequest;
