/**
 * NapCat 适配器类型定义
 * 覆盖 OneBot11 标准 + go-cqhttp 扩展 + NapCat 独有 API
 */

// ── 配置 ─────────────────────────────────────────────────────────────

export interface NapCatConfigBase {
  context: 'napcat';
  name: string;
  access_token?: string;
}

/** 正向 WebSocket */
export interface NapCatWsClientConfig extends NapCatConfigBase {
  connection: 'ws';
  url: string;
  reconnect_interval?: number;
  heartbeat_interval?: number;
}

/** 反向 WebSocket */
export interface NapCatWsServerConfig extends NapCatConfigBase {
  connection: 'wss';
  path: string;
  heartbeat_interval?: number;
}

/** HTTP API + POST 上报 */
export interface NapCatHttpConfig extends NapCatConfigBase {
  connection: 'http';
  /** NapCat HTTP API 地址，如 http://127.0.0.1:3000 */
  http_url: string;
  /** HTTP POST 事件上报接收路径，如 /napcat/post */
  post_path: string;
  /** 轮询间隔(ms)，用于 HTTP 心跳检测，默认 30000 */
  poll_interval?: number;
}

export type NapCatBotConfig = NapCatWsClientConfig | NapCatWsServerConfig | NapCatHttpConfig;

// ── API 响应 ─────────────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  status: string;
  retcode: number;
  data: T;
  echo?: string;
  message?: string;
  wording?: string;
}

// ── OneBot11 消息段 ──────────────────────────────────────────────────

export interface MessageSegment {
  type: string;
  data: Record<string, any>;
}

// ── OneBot11 事件基础 ────────────────────────────────────────────────

export interface NapCatEvent {
  post_type: 'message' | 'message_sent' | 'notice' | 'request' | 'meta_event';
  self_id: number;
  time: number;
}

export interface NapCatMessageEvent extends NapCatEvent {
  post_type: 'message' | 'message_sent';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: {
    user_id: number;
    nickname: string;
    card?: string;
    sex?: string;
    age?: number;
    area?: string;
    level?: string;
    role?: 'owner' | 'admin' | 'member';
    title?: string;
  };
}

export interface NapCatNoticeEvent extends NapCatEvent {
  post_type: 'notice';
  notice_type: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  message_id?: number;
  target_id?: number;
  file?: { id: string; name: string; size: number; busid: number; url?: string };
  duration?: number;
  sender_id?: number;
  title?: string;
  action?: string;
  suffix?: string;
  comment?: string;
  flag?: string;
}

export interface NapCatRequestEvent extends NapCatEvent {
  post_type: 'request';
  request_type: 'friend' | 'group';
  sub_type?: string;
  user_id: number;
  group_id?: number;
  comment?: string;
  flag: string;
}

export interface NapCatMetaEvent extends NapCatEvent {
  post_type: 'meta_event';
  meta_event_type: string;
  sub_type?: string;
  status?: any;
  interval?: number;
}

// ── 发送者信息 ───────────────────────────────────────────────────────

export interface SenderInfo {
  id: string;
  name: string;
  role?: 'owner' | 'admin' | 'member';
  isOwner?: boolean;
  isAdmin?: boolean;
  card?: string;
  title?: string;
}

// ── API 数据类型 ─────────────────────────────────────────────────────

export interface LoginInfo {
  user_id: number;
  nickname: string;
}

export interface StrangerInfo {
  user_id: number;
  nickname: string;
  sex: string;
  age: number;
  qid?: string;
  level?: number;
  login_days?: number;
}

export interface FriendInfo {
  user_id: number;
  nickname: string;
  remark: string;
}

export interface GroupInfo {
  group_id: number;
  group_name: string;
  group_memo?: string;
  group_create_time?: number;
  group_level?: number;
  member_count: number;
  max_member_count: number;
}

export interface GroupMemberInfo {
  group_id: number;
  user_id: number;
  nickname: string;
  card: string;
  sex: string;
  age: number;
  area: string;
  join_time: number;
  last_sent_time: number;
  level: string;
  role: 'owner' | 'admin' | 'member';
  unfriendly: boolean;
  title: string;
  title_expire_time: number;
  card_changeable: boolean;
  shut_up_timestamp?: number;
}

export interface MessageInfo {
  time: number;
  message_type: string;
  message_id: number;
  real_id: number;
  sender: { user_id: number; nickname: string; card?: string };
  message: MessageSegment[];
}

export interface ForwardMessage {
  messages: Array<{ content: MessageSegment[]; sender: { nickname: string; user_id: number }; time: number }>;
}

export interface GroupHonorInfo {
  group_id: number;
  current_talkative?: { user_id: number; nickname: string; avatar: string; day_count: number };
  talkative_list?: any[];
  performer_list?: any[];
  legend_list?: any[];
  strong_newbie_list?: any[];
  emotion_list?: any[];
}

export interface EssenceMessage {
  sender_id: number;
  sender_nick: string;
  sender_time: number;
  operator_id: number;
  operator_nick: string;
  operator_time: number;
  message_id: number;
}

export interface GroupFileSystemInfo {
  file_count: number;
  limit_count: number;
  used_space: number;
  total_space: number;
}

export interface GroupFileInfo {
  files: Array<{ group_id: number; file_id: string; file_name: string; busid: number; file_size: number; upload_time: number; dead_time: number; modify_time: number; download_times: number; uploader: number; uploader_name: string }>;
  folders: Array<{ group_id: number; folder_id: string; folder_name: string; create_time: number; creator: number; creator_name: string; total_file_count: number }>;
}

export interface GroupNotice {
  sender_id: number;
  publish_time: number;
  message: { text: string; images?: Array<{ id: string; height: string; width: string }> };
}

export interface VersionInfo {
  app_name: string;
  app_version: string;
  protocol_version: string;
  [key: string]: any;
}

export interface OnlineStatus {
  status: number;
  ext_status: number;
}

export interface AiCharacter {
  character_id: string;
  character_name: string;
  preview_url?: string;
}

export interface CollectionItem {
  id: string;
  type: number;
  content: string;
  create_time: number;
}
