import type { Adapters } from '../adapter.js';
import type { MessageSender } from '../types.js';

/**
 * Side Event 共享基础结构（Notice 与 Request 共用）。
 * 字段统一为 `$foo_bar` 命名。
 *
 * 完整事件名：`${$type}.${$scene_type}.${$sub_type}`（见 `formatSideEventName`）。
 */
export interface SideEventBase {
  /** 平台侧去重键 / flag（非 DB 行 id） */
  $id: string;
  $adapter: keyof Adapters;
  $endpoint: string;
  /** 命名空间：`notice` 或 `request` */
  $type: string;
  /** 平台场景 ID（群号、用户号、频道 ID 等） */
  $scene_id: string;
  /** 场景域（如 group、friend、channel、endpoint） */
  $scene_type?: string;
  /** 动作子类型（如 member_increase、add、poke） */
  $sub_type?: string;
  /** 主参与者（原 Notice.$operator / Request.$sender） */
  $actor?: MessageSender;
  /** 被操作对象 */
  $target?: MessageSender;
  /** 毫秒时间戳 */
  $timestamp: number;
}

/** 组合 Side Event 完整类型名 */
export function composeSideEventName(
  type: string,
  sceneType: string | undefined,
  subType: string | undefined,
): string {
  return [type, sceneType, subType].filter((p): p is string => !!p).join('.');
}

/** 从 Side Event 字段生成完整类型名 */
export function formatSideEventName(
  event: Pick<SideEventBase, '$type' | '$scene_type' | '$sub_type'>,
): string {
  return composeSideEventName(event.$type, event.$scene_type, event.$sub_type);
}

/** 判断 Side Event 是否匹配完整类型名（如 `notice.group.member_increase`） */
export function matchesSideEventName(
  event: Pick<SideEventBase, '$type' | '$scene_type' | '$sub_type'>,
  fullName: string,
): boolean {
  return formatSideEventName(event) === fullName;
}

/** 解析完整类型名为三段 */
export function parseSideEventName(fullName: string): {
  type: string;
  scene_type?: string;
  sub_type?: string;
} {
  const parts = fullName.split('.');
  return {
    type: parts[0] ?? '',
    scene_type: parts[1],
    sub_type: parts.slice(2).join('.') || undefined,
  };
}

/** 将 Side Event 场景映射为 IM 发送通道（group-suite 等消费者用） */
export function sideEventSendChannel(
  event: Pick<SideEventBase, '$scene_type' | '$scene_id'>,
): { id: string; type: 'group' | 'private' | 'channel' } {
  const domain = event.$scene_type ?? 'private';
  if (domain === 'group') return { id: event.$scene_id, type: 'group' };
  if (domain === 'channel') return { id: event.$scene_id, type: 'channel' };
  return { id: event.$scene_id, type: 'private' };
}
