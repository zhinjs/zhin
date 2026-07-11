/**
 * Side Event 标准类型。
 * 运行时 `$type` 仅存命名空间（`notice` / `request`）；
 * 完整名由 `${$type}.${$scene_type}.${$sub_type}` 组合。
 */

export type SideEventKind = 'notice' | 'request';

export type NoticeKind = 'notice';
export type RequestKind = 'request';

/** 完整组合名（测试 / 文档 / 消费者匹配用） */
export type ComposedNoticeName =
  | 'notice.group.member_increase'
  | 'notice.group.member_decrease'
  | 'notice.group.admin_change'
  | 'notice.group.ban'
  | 'notice.group.recall'
  | 'notice.group.poke'
  | 'notice.group.transfer'
  | 'notice.group.upload'
  | 'notice.group.emoji_reaction'
  | 'notice.group.card_change'
  | 'notice.group.essence_add'
  | 'notice.group.essence_delete'
  | 'notice.friend.recall'
  | 'notice.friend.increase'
  | 'notice.friend.poke'
  | 'notice.endpoint.lifecycle'
  | (string & {});

export type ComposedRequestName =
  | 'request.friend.add'
  | 'request.group.add'
  | 'request.group.invite'
  | (string & {});

/** @deprecated 使用 ComposedNoticeName + formatSideEventName */
export type NoticeType = ComposedNoticeName;
/** @deprecated 使用 ComposedRequestName + formatSideEventName */
export type RequestType = ComposedRequestName;

export interface SideEventParts {
  scene_type: string;
  sub_type: string;
}

/** OneBot / icqq 等平台 notice_type 原始值 → 标准 scene_type + sub_type */
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
};

/** KOOK extra.type 原始值 → 标准 scene_type + sub_type */
export const KOOK_NOTICE_PARTS_MAP: Record<string, SideEventParts> = {
  joined_guild: { scene_type: 'group', sub_type: 'member_increase' },
  exited_guild: { scene_type: 'group', sub_type: 'member_decrease' },
  deleted_message: { scene_type: 'group', sub_type: 'recall' },
  deleted_private_message: { scene_type: 'friend', sub_type: 'recall' },
  added_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  deleted_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  private_added_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
  private_deleted_reaction: { scene_type: 'group', sub_type: 'emoji_reaction' },
};

/** Slack event type 原始值 → 标准 scene_type + sub_type */
export const SLACK_NOTICE_PARTS_MAP: Record<string, SideEventParts> = {
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
