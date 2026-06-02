import { Adapters } from './adapter.js';
import type { MessageSender } from './types.js';

/**
 * 通知类型枚举
 *
 * 常见 IM 通知事件分类：
 * - group_member_increase: 群成员增加（入群）
 * - group_member_decrease: 群成员减少（退群/被踢）
 * - group_admin_change:    群管理员变动
 * - group_ban:             群禁言
 * - group_recall:          群消息撤回
 * - friend_recall:         好友消息撤回
 * - friend_add:            新增好友
 * - group_poke:            群戳一戳
 * - friend_poke:           好友戳一戳
 * - group_transfer:        群转让
 *
 * 适配器可自行扩展更多子类型
 */
export type NoticeType =
  | 'group_member_increase'
  | 'group_member_decrease'
  | 'group_admin_change'
  | 'group_ban'
  | 'group_recall'
  | 'friend_recall'
  | 'friend_add'
  | 'group_poke'
  | 'friend_poke'
  | 'group_transfer'
  | (string & {}); // 允许适配器扩展自定义类型

/**
 * 通知频道信息
 */
export interface NoticeChannel {
  id: string;
  type: 'group' | 'private' | 'channel';
}

/**
 * 通知基础结构
 *
 * 与 MessageBase 同构设计，所有通知共享以下字段。
 * 适配器通过 `Notice.from(raw, base)` 合并平台原始数据和标准字段。
 *
 * @example
 * ```typescript
 * // 适配器中格式化通知
 * const notice = Notice.from(rawEvent, {
 *   $id: rawEvent.id,
 *   $adapter: 'icqq',
 *   $bot: botName,
 *   $type: 'group_member_decrease',
 *   $subType: 'kick',
 *   $channel: { id: groupId, type: 'group' },
 *   $operator: { id: operatorId, name: '管理员' },
 *   $target: { id: userId, name: '被踢者' },
 *   $timestamp: Date.now(),
 * });
 * this.adapter.emit('notice.receive', notice);
 * ```
 */
export interface NoticeBase {
  /** 通知唯一 ID（平台提供或自生成） */
  $id: string;
  /** 适配器名称 */
  $adapter: keyof Adapters;
  /** Bot 名称 */
  $bot: string;
  /** 通知类型 */
  $type: NoticeType;
  /** 通知子类型（如 leave/kick、set/unset） */
  $subType?: string;
  /** 通知发生的频道/群/会话 */
  $channel: NoticeChannel;
  /** 操作者信息（如管理员） */
  $operator?: MessageSender;
  /** 被操作目标信息（如被踢的成员） */
  $target?: MessageSender;
  /** 通知时间戳 */
  $timestamp: number;
}

/**
 * 完整通知类型，支持平台原始数据扩展
 */
export type Notice<T extends object = {}> = NoticeBase & T;

export namespace Notice {
  /**
   * 工具方法：合并自定义字段与基础通知结构
   */
  export function from<T extends object>(input: T, format: NoticeBase): Notice<T> {
    return Object.assign(input, format);
  }
}
