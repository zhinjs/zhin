import { Adapters } from './adapter.js';
import type { MessageSender, MaybePromise } from './types.js';

/**
 * 请求类型枚举
 *
 * 常见 IM 请求事件分类：
 * - friend_add:  好友添加请求
 * - group_add:   主动申请入群
 * - group_invite: 邀请入群请求
 *
 * 适配器可自行扩展更多子类型
 */
export type RequestType =
  | 'friend_add'
  | 'group_add'
  | 'group_invite'
  | (string & {}); // 允许适配器扩展自定义类型

/**
 * 请求频道信息
 */
export interface RequestChannel {
  id: string;
  type: 'group' | 'private' | 'channel';
}

/**
 * 请求基础结构
 *
 * 与 MessageBase / NoticeBase 同构设计。
 * 核心区别：Request 提供 `$approve()` 和 `$reject()` 方法，用于快速处理请求。
 *
 * @example
 * ```typescript
 * // 适配器中格式化请求
 * const request = Request.from(rawEvent, {
 *   $id: rawEvent.flag,
 *   $adapter: 'icqq',
 *   $bot: botName,
 *   $type: 'group_invite',
 *   $channel: { id: groupId, type: 'group' },
 *   $sender: { id: userId, name: '邀请者' },
 *   $comment: '请求加群消息',
 *   $timestamp: Date.now(),
 *   $approve: async (remark?) => { await api.approve(flag, remark); },
 *   $reject: async (reason?) => { await api.reject(flag, reason); },
 * });
 * this.adapter.emit('request.receive', request);
 * ```
 */
export interface RequestBase {
  /** 请求唯一 ID / flag（平台提供的请求标识，用于后续处理） */
  $id: string;
  /** 适配器名称 */
  $adapter: keyof Adapters;
  /** Bot 名称 */
  $bot: string;
  /** 请求类型 */
  $type: RequestType;
  /** 请求子类型 */
  $subType?: string;
  /** 请求发生的频道/群/会话 */
  $channel: RequestChannel;
  /** 请求发送者 */
  $sender: MessageSender;
  /** 请求附言/验证消息 */
  $comment?: string;
  /** 请求时间戳 */
  $timestamp: number;
  /**
   * 同意请求
   * @param remark 备注信息（如好友备注）
   */
  $approve(remark?: string): MaybePromise<void>;
  /**
   * 拒绝请求
   * @param reason 拒绝原因
   */
  $reject(reason?: string): MaybePromise<void>;
}

/**
 * 完整请求类型，支持平台原始数据扩展
 */
export type Request<T extends object = {}> = RequestBase & T;

export namespace Request {
  /**
   * 工具方法：合并自定义字段与基础请求结构
   */
  export function from<T extends object>(input: T, format: RequestBase): Request<T> {
    return Object.assign(input, format);
  }
}
