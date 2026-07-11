import type { Adapters } from './adapter.js';
import type { NoticeKind } from './side-event/types.js';
import type { SideEventBase } from './side-event/base.js';

export type { NoticeKind, ComposedNoticeName, NoticeType } from './side-event/types.js';
export type { SideEventBase } from './side-event/base.js';
export {
  composeSideEventName,
  formatSideEventName,
  matchesSideEventName,
  parseSideEventName,
  sideEventSendChannel,
} from './side-event/base.js';

/**
 * 通知基础结构 — 继承 SideEventBase。
 *
 * @example
 * ```typescript
 * const notice = Notice.from(rawEvent, {
 *   $id: rawEvent.id,
 *   $adapter: 'icqq',
 *   $endpoint: endpointId,
 *   $type: 'notice',
 *   $scene_id: groupId,
 *   $scene_type: 'group',
 *   $sub_type: 'member_decrease',
 *   $actor: { id: operatorId, name: '管理员' },
 *   $target: { id: userId, name: '被踢者' },
 *   $timestamp: Date.now(),
 * });
 * // formatSideEventName(notice) === 'notice.group.member_decrease'
 * this.adapter.emit('notice.receive', notice);
 * ```
 */
export interface NoticeBase extends SideEventBase {
  $adapter: keyof Adapters;
  $type: NoticeKind;
}

/**
 * 完整通知类型，支持平台原始数据扩展
 */
export type Notice<T extends object = {}> = NoticeBase & T;

export namespace Notice {
  export function from<T extends object>(input: T, format: NoticeBase): Notice<T> {
    return Object.assign(input, format);
  }
}
