import type { SideEventParts } from '@zhin.js/core';

/** Slack event type 原始值 → 标准 scene_type + sub_type */
export const SLACK_NOTICE_PARTS_MAP: Readonly<Record<string, SideEventParts>> = {
  member_joined_channel: { scene_type: 'group', sub_type: 'member_increase' },
  member_left_channel: { scene_type: 'group', sub_type: 'member_decrease' },
  reaction_added: { scene_type: 'group', sub_type: 'emoji_reaction' },
  reaction_removed: { scene_type: 'group', sub_type: 'emoji_reaction' },
  message_deleted: { scene_type: 'group', sub_type: 'recall' },
  channel_archive: { scene_type: 'slack', sub_type: 'channel_archive' },
  channel_unarchive: { scene_type: 'slack', sub_type: 'channel_unarchive' },
  channel_rename: { scene_type: 'slack', sub_type: 'channel_rename' },
  channel_created: { scene_type: 'slack', sub_type: 'channel_created' },
  channel_deleted: { scene_type: 'slack', sub_type: 'channel_deleted' },
  pin_added: { scene_type: 'slack', sub_type: 'pin_added' },
  pin_removed: { scene_type: 'slack', sub_type: 'pin_removed' },
  app_home_opened: { scene_type: 'slack', sub_type: 'app_home_opened' },
  team_join: { scene_type: 'friend', sub_type: 'increase' },
};

/** 已登记的 Slack 事件映射为标准 scene_type + sub_type；未登记返回 undefined。 */
export function mapSlackNoticeParts(raw: string): SideEventParts | undefined {
  return Object.prototype.hasOwnProperty.call(SLACK_NOTICE_PARTS_MAP, raw) ? SLACK_NOTICE_PARTS_MAP[raw] : undefined;
}
