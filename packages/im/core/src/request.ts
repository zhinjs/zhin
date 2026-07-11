import type { MaybePromise } from './types.js';
import type { Adapters } from './adapter.js';
import type { RequestKind } from './side-event/types.js';
import type { SideEventBase } from './side-event/base.js';

export type { RequestKind, ComposedRequestName, RequestType } from './side-event/types.js';

/**
 * 请求基础结构 — 继承 SideEventBase，附加审批方法。
 *
 * @example
 * ```typescript
 * const request = Request.from(rawEvent, {
 *   $id: rawEvent.flag,
 *   $adapter: 'icqq',
 *   $endpoint: endpointId,
 *   $type: 'request',
 *   $scene_id: groupId,
 *   $scene_type: 'group',
 *   $sub_type: 'invite',
 *   $actor: { id: userId, name: '邀请者' },
 *   $comment: '请求加群消息',
 *   $timestamp: Date.now(),
 *   $approve: async (remark?) => { await api.approve(flag, remark); },
 *   $reject: async (reason?) => { await api.reject(flag, reason); },
 * });
 * // formatSideEventName(request) === 'request.group.invite'
 * this.adapter.emit('request.receive', request);
 * ```
 */
export interface RequestBase extends SideEventBase {
  $adapter: keyof Adapters;
  $type: RequestKind;
  /** 主参与者（必填） */
  $actor: NonNullable<SideEventBase['$actor']>;
  $comment?: string;
  $approve(remark?: string): MaybePromise<void>;
  $reject(reason?: string): MaybePromise<void>;
}

export type Request<T extends object = {}> = RequestBase & T;

export namespace Request {
  export function from<T extends object>(input: T, format: RequestBase): Request<T> {
    return Object.assign(input, format);
  }
}
