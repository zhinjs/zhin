/**
 * IPC 协议类型定义与 Action 常量 (ported from @icqqjs/cli)
 *
 * CLI 与守护进程通过 Unix Domain Socket 通信，
 * 使用 JSON + 换行符（\n）分隔的文本协议。
 */

/** CLI → Daemon 请求 */
export type IpcRequest = {
  id: string;
  action: string;
  params: Record<string, unknown>;
};

/** Daemon → CLI 响应 */
export type IpcResponse = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

/** Daemon → CLI 事件推送 */
export type IpcEvent = {
  id: string;
  event: string;
  data: unknown;
};

export type IpcMessage = IpcResponse | IpcEvent;

/** 收到的消息事件数据 */
export interface IpcMessageEventData {
  type: "group" | "private";
  from_id: number;
  user_id: number;
  nickname: string;
  raw_message: string;
  time: number;
  group_id?: number;
}

/** Guild 消息事件数据 */
export interface IpcGuildMessageEventData {
  type: "guild";
  guild_id: string;
  guild_name: string;
  channel_id: string;
  channel_name: string;
  nickname: string;
  tiny_id: string;
  raw_message: string;
  time: number;
  seq: number;
}

/**
 * 所有 IPC 操作常量 (from @icqqjs/cli)
 */
export const Actions = {
  PING: "ping",

  // ── 列表查询 ──
  LIST_FRIENDS: "list_friends",
  LIST_GROUPS: "list_groups",
  LIST_GROUP_MEMBERS: "list_group_members",
  LIST_BLACKLIST: "list_blacklist",
  LIST_FRIEND_CLASSES: "list_friend_classes",

  // ── 信息查询 ──
  GET_FRIEND_INFO: "get_friend_info",
  GET_GROUP_INFO: "get_group_info",
  GET_GROUP_MEMBER_INFO: "get_group_member_info",
  GET_STRANGER_INFO: "get_stranger_info",
  GET_STATUS: "get_status",
  GET_SELF_PROFILE: "get_self_profile",

  // ── 消息发送 ──
  SEND_PRIVATE_MSG: "send_private_msg",
  SEND_GROUP_MSG: "send_group_msg",

  // ── 消息操作 ──
  RECALL_MSG: "recall_msg",
  GET_MSG: "get_msg",
  HISTORY_PRIVATE: "history_private",
  HISTORY_GROUP: "history_group",
  MARK_READ: "mark_read",
  DELETE_MSG: "delete_msg",

  // ── 个人设置 ──
  SET_NICKNAME: "set_nickname",
  SET_GENDER: "set_gender",
  SET_BIRTHDAY: "set_birthday",
  SET_SIGNATURE: "set_signature",
  SET_DESCRIPTION: "set_description",
  SET_AVATAR: "set_avatar",
  SET_ONLINE_STATUS: "set_online_status",

  // ── 群设置 ──
  SET_GROUP_NAME: "set_group_name",
  SET_GROUP_AVATAR: "set_group_avatar",
  SET_GROUP_CARD: "set_group_card",
  SET_GROUP_TITLE: "set_group_title",
  SET_GROUP_ADMIN: "set_group_admin",
  SET_GROUP_REMARK: "set_group_remark",

  // ── 群管理 ──
  GROUP_MUTE: "group_mute",
  GROUP_MUTE_ALL: "group_mute_all",
  GROUP_KICK: "group_kick",
  GROUP_QUIT: "group_quit",
  GROUP_INVITE: "group_invite",
  GROUP_POKE: "group_poke",
  GROUP_ANNOUNCE: "group_announce",
  GROUP_SIGN: "group_sign",
  GROUP_ESSENCE_ADD: "group_essence_add",
  GROUP_ESSENCE_REMOVE: "group_essence_remove",
  GROUP_ALLOW_ANONY: "group_allow_anony",
  GROUP_MUTED_LIST: "group_muted_list",
  GROUP_AT_ALL_REMAIN: "group_at_all_remain",

  // ── 好友操作 ──
  FRIEND_POKE: "friend_poke",
  FRIEND_LIKE: "friend_like",
  FRIEND_DELETE: "friend_delete",
  FRIEND_REMARK: "friend_remark",
  FRIEND_CLASS: "friend_class",

  // ── 系统消息/请求 ──
  GET_SYSTEM_MSG: "get_system_msg",
  HANDLE_FRIEND_REQUEST: "handle_friend_request",
  HANDLE_GROUP_REQUEST: "handle_group_request",

  // ── 好友分组 ──
  ADD_FRIEND_CLASS: "add_friend_class",
  DELETE_FRIEND_CLASS: "delete_friend_class",
  RENAME_FRIEND_CLASS: "rename_friend_class",

  // ── 群文件系统 ──
  GFS_LIST: "gfs_list",
  GFS_INFO: "gfs_info",
  GFS_MKDIR: "gfs_mkdir",
  GFS_DELETE: "gfs_delete",
  GFS_RENAME: "gfs_rename",
  GFS_STAT: "gfs_stat",
  GFS_MOVE: "gfs_move",
  GFS_DOWNLOAD: "gfs_download",

  // ── 其他功能 ──
  IMAGE_OCR: "image_ocr",
  RELOAD_FRIEND_LIST: "reload_friend_list",
  RELOAD_GROUP_LIST: "reload_group_list",
  CLEAN_CACHE: "clean_cache",
  GET_GROUP_SHARE: "get_group_share",

  // ── 群管理扩展 ──
  GROUP_SET_JOIN_TYPE: "group_set_join_type",
  GROUP_SET_RATE_LIMIT: "group_set_rate_limit",
  GROUP_MUTE_ANONY: "group_mute_anony",
  GROUP_ANON_INFO: "group_anon_info",

  // ── 好友操作扩展 ──
  ADD_FRIEND: "add_friend",
  SEND_TEMP_MSG: "send_temp_msg",

  // ── 漫游表情 ──
  GET_ROAMING_STAMP: "get_roaming_stamp",
  DELETE_STAMP: "delete_stamp",

  // ── 文件传输 ──
  SEND_PRIVATE_FILE: "send_private_file",
  SEND_GROUP_FILE: "send_group_file",
  FRIEND_RECALL_FILE: "friend_recall_file",
  GFS_UPLOAD: "gfs_upload",

  // ── 群消息表态 ──
  GROUP_SET_REACTION: "group_set_reaction",
  GROUP_DEL_REACTION: "group_del_reaction",

  // ── 转发消息 ──
  GET_FORWARD_MSG: "get_forward_msg",
  MAKE_FORWARD_MSG: "make_forward_msg",

  // ── 频道系统 ──
  GUILD_LIST: "guild_list",
  GUILD_INFO: "guild_info",
  GUILD_CHANNELS: "guild_channels",
  GUILD_MEMBERS: "guild_members",
  GUILD_SEND_MSG: "guild_send_msg",
  GUILD_RECALL_MSG: "guild_recall_msg",

  // ── 用户文件操作 ──
  GET_FILE_INFO: "get_file_info",
  GET_FILE_URL: "get_file_url",
  GET_AVATAR_URL: "get_avatar_url",
  GET_GROUP_AVATAR_URL: "get_group_avatar_url",

  // ── 屏蔽群成员消息 ──
  SET_SCREEN_MEMBER_MSG: "set_screen_member_msg",

  // ── 群文件转发 ──
  GFS_FORWARD: "gfs_forward",
  GFS_FORWARD_OFFLINE: "gfs_forward_offline",

  // ── 重载列表 ──
  RELOAD_BLACKLIST: "reload_blacklist",
  RELOAD_STRANGER_LIST: "reload_stranger_list",
  RELOAD_GUILDS: "reload_guilds",

  // ── 在线状态查询 ──
  GET_STATUS_INFO: "get_status_info",

  // ── 密钥/工具 ──
  GET_CLIENT_KEY: "get_client_key",
  GET_PSKEY: "get_pskey",
  UID2UIN: "uid2uin",
  UIN2UID: "uin2uid",

  // ── 视频/加好友设置 ──
  GET_VIDEO_URL: "get_video_url",
  GET_ADD_FRIEND_SETTING: "get_add_friend_setting",

  // ── 频道扩展 ──
  GET_FORUM_URL: "get_forum_url",
  GUILD_CHANNEL_SHARE: "guild_channel_share",

  // ── 获取图片/语音 URL ──
  GET_PIC_URL: "get_pic_url",
  GET_PTT_URL: "get_ptt_url",

  // ── 消息订阅 ──
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",

  // ── Webhook ──
  SET_WEBHOOK: "set_webhook",
  GET_WEBHOOK: "get_webhook",

  // ── 系统通知 ──
  SET_NOTIFY: "set_notify",
  GET_NOTIFY: "get_notify",
} as const;
