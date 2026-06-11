/**
 * ICQQ 适配器类型与配置
 *
 * 不再直接依赖 @icqqjs/icqq，通过 @icqqjs/cli 守护进程 IPC 通信。
 */

export type GroupRole = "owner" | "admin" | "member";

export interface IcqqSenderInfo {
  id: string;
  name: string;
  role?: GroupRole;
  isOwner?: boolean;
  isAdmin?: boolean;
  permissions?: string[];
  card?: string;
  title?: string;
}

/**
 * Typing Indicator 配置
 */
export interface TypingIndicatorConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 默认表情（默认 '⏳'） */
  defaultEmoji?: string;
  /** 是否在完成后自动移除（默认 true） */
  autoRemove?: boolean;
  /** 自动移除延迟，毫秒（默认 5000） */
  removeDelay?: number;
  /** 私聊配置 */
  privateConfig?: {
    /** 提示类型 */
    type: 'message' | 'reaction';
    /** 消息内容（type='message' 时使用） */
    message?: string;
    /** 表情符号（type='reaction' 时使用） */
    emoji?: string;
    /** 是否自动移除 */
    autoRemove?: boolean;
    /** 自动移除延迟 */
    removeDelay?: number;
  };
  /** 群聊配置 */
  groupConfig?: {
    /** 提示类型 */
    type: 'message' | 'reaction';
    /** 消息内容（type='message' 时使用） */
    message?: string;
    /** 表情符号（type='reaction' 时使用） */
    emoji?: string;
    /** 是否自动移除 */
    autoRemove?: boolean;
    /** 自动移除延迟 */
    removeDelay?: number;
  };
}

/**
 * Endpoint 配置：支持本地 IPC 和远程 RPC 两种连接模式。
 *
 * - 本地模式（默认）：只需 name（QQ号），自动连接 ~/.icqq/<uin>/daemon.sock
 * - 远程模式：额外配置 rpc.host / rpc.port / rpc.token
 */
export interface IcqqEndpointConfig {
  context: "icqq";
  /** QQ 号码字符串 */
  name: `${number}`;
  /** RPC 远程连接配置（不配置则使用本地 IPC） */
  rpc?: {
    /** 远程主机地址 */
    host: string;
    /** 远程端口 */
    port: number;
    /** 认证 token（用于 HMAC-SHA256 挑战-响应，不会明文传输） */
    token: string;
  };
  /**
   * IPC/RPC 与守护进程连接意外断开时是否自动重连（指数退避，上限约 30s）。
   * 默认 true；设为 false 则断开后仅将 `$connected` 置为 false，需手动重连。
   */
  autoReconnect?: boolean;
  /**
   * Typing Indicator 配置
   * 用于在 AI 处理消息时提示用户正在处理中
   */
  typingIndicator?: TypingIndicatorConfig;
  /**
   * 出站图片/语音/视频：file=本机临时文件路径（需与 icqq 守护进程同机可读）；
   * base64=经 CQ `base64://` 交给守护进程解码（Zhin 与 icqq 异进程/异机时用，配置 rpc 时默认 base64）。
   */
  outboundMedia?: "file" | "base64";
}

/** IPC 返回的好友信息 */
export interface IpcFriendInfo {
  user_id: number;
  nickname: string;
  remark?: string;
  class_id?: number;
}

/** IPC 返回的群信息 */
export interface IpcGroupInfo {
  group_id: number;
  group_name: string;
  member_count: number;
  max_member_count: number;
  owner_id?: number;
}

/** IPC 返回的群成员信息 */
export interface IpcMemberInfo {
  user_id: number;
  nickname: string;
  card: string;
  role: GroupRole;
  title: string;
  join_time?: number;
  last_sent_time?: number;
  shutup_time?: number;
}
