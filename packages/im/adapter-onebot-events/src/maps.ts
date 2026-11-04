import type { SideEventParts } from '@zhin.js/core';

/** OneBot v11 / NapCat 的 notice_type 原始值 → 标准 scene_type + sub_type */
export const ONEBOT_NOTICE_PARTS_MAP: Record<string, SideEventParts> = {
  group_increase: { scene_type: 'group', sub_type: 'member_increase' },
  group_decrease: { scene_type: 'group', sub_type: 'member_decrease' },
  group_admin: { scene_type: 'group', sub_type: 'admin_change' },
  group_ban: { scene_type: 'group', sub_type: 'ban' },
  group_recall: { scene_type: 'group', sub_type: 'recall' },
  friend_recall: { scene_type: 'friend', sub_type: 'recall' },
  friend_add: { scene_type: 'friend', sub_type: 'increase' },
  group_upload: { scene_type: 'group', sub_type: 'upload' },
  group_transfer: { scene_type: 'group', sub_type: 'transfer' },
  group_card: { scene_type: 'group', sub_type: 'card_change' },
  group_msg_emoji_like: { scene_type: 'group', sub_type: 'emoji_reaction' },
  'group.increase': { scene_type: 'group', sub_type: 'member_increase' },
  'group.decrease': { scene_type: 'group', sub_type: 'member_decrease' },
  'group.admin': { scene_type: 'group', sub_type: 'admin_change' },
  'group.ban': { scene_type: 'group', sub_type: 'ban' },
  'group.recall': { scene_type: 'group', sub_type: 'recall' },
  'friend.increase': { scene_type: 'friend', sub_type: 'increase' },
  'friend.decrease': { scene_type: 'friend', sub_type: 'recall' },
  'friend.recall': { scene_type: 'friend', sub_type: 'recall' },
  'group.poke': { scene_type: 'group', sub_type: 'poke' },
  'group.reaction': { scene_type: 'group', sub_type: 'emoji_reaction' },
  'group.transfer': { scene_type: 'group', sub_type: 'transfer' },
  'group.card': { scene_type: 'group', sub_type: 'card_change' },
  'group.notice': { scene_type: 'group', sub_type: 'notice_updated' },
  group_notice: { scene_type: 'group', sub_type: 'notice_updated' },
};

/**
 * icqq 与标准 OneBot 的差异覆盖表。
 *
 * icqq 把 OneBot 的 `group_increase` 这类下划线 notice_type 拆成
 * `notice_type=group` + `sub_type=increase`，所以这里按 `${notice_type}.${sub_type}`
 * 取值；命中不了就回退到标准映射。其余行为与 OneBot 一致，无需再列。
 */
export const ICQQ_NOTICE_OVERRIDES: Readonly<Record<string, SideEventParts>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(ONEBOT_NOTICE_PARTS_MAP).filter(([key]) => key.includes('.')),
  ),
});

/** 本包识别的 OneBot 系协议；覆盖表按此取值，其余视为未知协议。 */
export type OneBotEventFlavor = 'onebot' | 'napcat' | 'icqq';

/** 各协议的 notice 覆盖表；未登记的协议只用标准映射。 */
export const NOTICE_OVERRIDES_BY_FLAVOR: Readonly<Record<string, Readonly<Record<string, SideEventParts>>>> = Object.freeze({
  icqq: ICQQ_NOTICE_OVERRIDES,
});
