/**
 * IPC 协议类型定义与 Action 常量 (ported from @icqqjs/cli)
 *
 * CLI 与守护进程通过 Unix Domain Socket 通信，
 * 使用 JSON + 换行符（\n）分隔的文本协议。
 *
 * 通信流程（@icqqjs/cli `src/daemon/protocol.ts`）：
 * 1. CLI 连接 Socket → auth（token）
 * 2. 认证通过后发送 IpcRequest → 等待 IpcResponse
 * 3. 认证通过后自动接收 icqq 事件推送（IpcEvent），断开连接自动停止
 *
 * 登录相关：**推送**走 IpcEvent（`system.login.*`）。
 */

import { pickCredential } from '@zhin.js/adapter';

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

/**
 * Daemon → CLI 事件推送（icqq client.em 分发的全部事件）
 *
 * 登录/重连时推送 `system.login.*`（如 `system.login.auth` 含 url + device），
 * 语义在 `event` 字段，不在 OneBot 式 `post_type` 里。
 */
export type IpcEvent = {
  /** 固定为 `"*"`，客户端应忽略，由本地 handler 按 `event` 过滤 */
  id: string;
  /** icqq 事件名，如 `system.login.auth`、`message.group.normal` */
  event: string;
  /** icqq 事件 toJSON 后的 plain object */
  data: unknown;
};

export type IpcMessage = IpcResponse | IpcEvent;

export type { IcqqIpcMessageEvent } from "./icqq-inbound.js";

/** 从 IPC 入站 payload 解析可用于引用/撤回的消息 ID */
export { resolveIcqqInboundMessageId } from "./icqq-inbound.js";

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
  LOGOUT: "logout",

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
  LIST_STRANGERS: "list_strangers",
  GET_PROFILE: "get_profile",
  GET_STATUS: "get_status",
  GET_ONLINE_STATUS: "get_online_status",
  GET_SELF_PROFILE: "get_self_profile",

  // ── 消息发送 ──
  SEND_PRIVATE_MSG: "send_private_msg",
  SEND_GROUP_MSG: "send_group_msg",

  // ── 消息操作 ──
  RECALL_MSG: "recall_msg",
  GET_MSG: "get_msg",
  HISTORY_PRIVATE: "history_private",
  HISTORY_GROUP: "history_group",
  HISTORY_BY_MSG_ID: "history_by_msg_id",
  SEND_LONG_MSG: "send_long_msg",
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
  FRIEND_FORWARD_FILE: "friend_forward_file",
  SEARCH_SAME_GROUP: "search_same_group",
  SEND_CONTACT_SHARE: "send_contact_share",
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
  GET_CHANNEL_INFO: "get_channel_info",
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
  UID2UINS: "uid2uins",
  UIN2UID: "uin2uid",
  UIN2UIDS: "uin2uids",
  GET_COOKIES: "get_cookies",
  GET_CSRF_TOKEN: "get_csrf_token",
  REFRESH_NT_PIC_RKEY: "refresh_nt_pic_rkey",
  SEND_DISCUSS_MSG: "send_discuss_msg",

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

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface IcqqAdapterConfig {
  readonly name?: string;
  readonly autoReconnect?: boolean;
  readonly outboundMedia?: 'file' | 'base64';
  readonly rpc?: {
    readonly host?: string;
    readonly port?: number;
    readonly token?: string;
  };
  /** Transitional: legacy root `endpoints[]` with `context: icqq`. */
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly name?: string;
    readonly autoReconnect?: boolean;
    readonly outboundMedia?: 'file' | 'base64';
    readonly rpc?: {
      readonly host?: string;
      readonly port?: number;
      readonly token?: string;
    };
  }>;
}

export interface ResolvedIcqqConfig {
  readonly context: 'icqq';
  readonly name: string;
  readonly autoReconnect: boolean;
  readonly outboundMedia?: 'file' | 'base64';
  readonly rpc?: {
    readonly host: string;
    readonly port: number;
    readonly token: string;
  };
}

export interface IcqqWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface IcqqInboundMessage {
  readonly id: string;
  readonly target: string;
  readonly content: string;
  readonly sender: string;
  readonly channelType: 'private' | 'group' | 'channel';
  readonly metadata?: Record<string, unknown>;
}

export type ParsedIcqqSendTarget =
  | { readonly kind: 'private'; readonly userId: number }
  | { readonly kind: 'group'; readonly groupId: number }
  | { readonly kind: 'temp'; readonly groupId: number; readonly userId: number }
  | { readonly kind: 'channel'; readonly guildId: string; readonly channelId: string };

export function resolveIcqqConfig(config: IcqqAdapterConfig = {}): ResolvedIcqqConfig {
  const entry = config.endpoints?.find((item) => item.context === 'icqq');
  const name = pickCredential(config.name, entry?.name, process.env.ICQQ_ACCOUNT);
  if (!/^\d+$/.test(name)) {
    throw new TypeError(
      'ICQQ adapter requires numeric name (QQ uin) via plugins.<key>.name or ICQQ_ACCOUNT',
    );
  }
  const autoReconnect = config.autoReconnect ?? entry?.autoReconnect ?? true;
  const outboundMedia = config.outboundMedia ?? entry?.outboundMedia;
  const rpcRaw = config.rpc ?? entry?.rpc;
  const rpc = rpcRaw?.host && rpcRaw.port != null && rpcRaw.token
    ? { host: rpcRaw.host, port: Number(rpcRaw.port), token: rpcRaw.token }
    : undefined;
  return {
    context: 'icqq',
    name,
    autoReconnect,
    ...(outboundMedia ? { outboundMedia } : {}),
    ...(rpc ? { rpc } : {}),
  };
}

/** Gateway reply target: `private:uid` / `group:gid` / `temp:gid:uid` / `channel:guild:channel`. */
export function formatInboundTarget(input: {
  readonly channelType: 'private' | 'group' | 'channel';
  readonly channelId: string;
  readonly channelParentGroupId?: string;
  readonly guildId?: string;
}): string {
  if (input.channelType === 'private' && input.channelParentGroupId) {
    return `temp:${input.channelParentGroupId}:${input.channelId}`;
  }
  if (input.channelType === 'channel' && input.guildId) {
    return `channel:${input.guildId}:${input.channelId}`;
  }
  return `${input.channelType}:${input.channelId}`;
}

export function parseSendTarget(target: string): ParsedIcqqSendTarget {
  const trimmed = target.trim();
  if (trimmed.startsWith('temp:')) {
    const rest = trimmed.slice(5);
    const [groupId, userId] = rest.split(':');
    if (!groupId || !userId) throw new TypeError(`Invalid icqq temp target: ${target}`);
    return { kind: 'temp', groupId: Number(groupId), userId: Number(userId) };
  }
  if (trimmed.startsWith('channel:')) {
    const rest = trimmed.slice(8);
    const idx = rest.indexOf(':');
    if (idx <= 0) throw new TypeError(`Invalid icqq channel target: ${target}`);
    return {
      kind: 'channel',
      guildId: rest.slice(0, idx),
      channelId: rest.slice(idx + 1),
    };
  }
  if (trimmed.startsWith('private:')) {
    return { kind: 'private', userId: Number(trimmed.slice(8)) };
  }
  if (trimmed.startsWith('group:')) {
    return { kind: 'group', groupId: Number(trimmed.slice(6)) };
  }
  // Bare numeric id → private (common reply path)
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'private', userId: Number(trimmed) };
  }
  throw new TypeError(`Invalid icqq send target: ${target}`);
}

export function formatOutboundBody(payload: unknown): string {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text || '\u200b';
  }
  if (payload == null) return '\u200b';
  if (!Array.isArray(payload)) {
    // 单个段对象（非数组）按单元素数组处理，杜绝 String(object) → '[object Object]'
    if (isWireSegment(payload)) {
      return formatOutboundBody([payload]);
    }
    if (typeof payload === 'object' && payload !== null && 'text' in payload) {
      const text = String((payload as { text?: unknown }).text ?? '').trim();
      return text || '\u200b';
    }
    const text = String(payload).trim();
    return text || '\u200b';
  }
  const joined = payload.map((seg) => {
    if (typeof seg === 'string') return seg;
    const item = seg as IcqqWireSegment;
    switch (item.type) {
      case 'text':
        return String(item.data?.text ?? '');
      case 'at':
      case 'mention':
        return `[at:${item.data?.qq ?? item.data?.id ?? item.data?.target ?? ''}]`;
      case 'image':
        return `[image:${item.data?.file || item.data?.url || base64Media(item.data) || ''}]`;
      case 'face':
        return `[face:${item.data?.id ?? ''}]`;
      case 'reply':
        return `[reply:${item.data?.message_id ?? item.data?.id ?? ''}]`;
      case 'record':
      case 'audio':
        return `[record:${item.data?.file || item.data?.url || base64Media(item.data) || ''}]`;
      case 'video':
        return `[video:${item.data?.file || item.data?.url || base64Media(item.data) || ''}]`;
      default:
        return String(item.data?.text ?? '');
    }
  }).join('').trim();
  return joined || '\u200b';
}

export function formatInboundContent(rawMessage: string): string {
  return rawMessage;
}

/** base64 媒体回退：CQ `base64://` 由守护进程解码（异机 RPC 场景）。 */
function base64Media(data: Record<string, unknown> | undefined): string | undefined {
  const b64 = data?.base64;
  return typeof b64 === 'string' && b64 ? `base64://${b64}` : undefined;
}

/** 段对象判定：`{ type: string, data? }`（非数组 payload 的防御入口）。 */
function isWireSegment(value: unknown): value is IcqqWireSegment {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string';
}
