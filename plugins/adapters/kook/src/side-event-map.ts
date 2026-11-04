import type { SideEventParts } from '@zhin.js/core';

/** KOOK extra.type 原始值 → 标准 scene_type + sub_type */
export const KOOK_NOTICE_PARTS_MAP: Readonly<Record<string, SideEventParts>> = {
  joined_guild: { scene_type: 'group', sub_type: 'member_increase' },
  exited_guild: { scene_type: 'group', sub_type: 'member_decrease' },
  deleted_message: { scene_type: 'group', sub_type: 'recall' },
  deleted_private_message: { scene_type: 'friend', sub_type: 'recall' },
  added_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  deleted_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  private_added_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  private_deleted_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
};

/** 已登记的 KOOK 通知映射为标准 scene_type + sub_type；未登记返回 undefined。 */
export function mapKookNoticeParts(raw: string): SideEventParts | undefined {
  return Object.prototype.hasOwnProperty.call(KOOK_NOTICE_PARTS_MAP, raw) ? KOOK_NOTICE_PARTS_MAP[raw] : undefined;
}
