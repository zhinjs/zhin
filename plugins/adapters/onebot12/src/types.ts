/**
 * OneBot 12 适配器类型（参考 https://12.onebot.dev/ ）
 */

/** 配置公共字段；单一适配器 context 均为 'onebot12'，连接方式由 connection 区分 */
export interface OneBot12ConfigBase {
  context: 'onebot12';
  name: string;
  /** 访问令牌，鉴权用 */
  access_token?: string;
}

/** 正向 WebSocket：应用连 OneBot 实现的 WS 服务器 */
export interface OneBot12WsConfig extends OneBot12ConfigBase {
  connection: 'ws';
  /** OneBot 实现提供的 WebSocket 地址，如 ws://127.0.0.1:6700 */
  url: string;
  reconnect_interval?: number;
  heartbeat_interval?: number;
}

/** HTTP Webhook：OneBot 实现 POST 事件到应用提供的 path */
export interface OneBot12WebhookConfig extends OneBot12ConfigBase {
  connection: 'webhook';
  /** 应用接收事件的 POST 路径 */
  path: string;
  /** 可选：OneBot 实现的 HTTP 端点，用于发消息等动作（实现 POST 事件到我们，我们 POST 动作到该 url） */
  api_url?: string;
}

/** 反向 WebSocket：应用开 WS 服务端，OneBot 实现连上来 */
export interface OneBot12WssConfig extends OneBot12ConfigBase {
  connection: 'wss';
  /** 应用侧 WS 路径 */
  path: string;
  heartbeat_interval?: number;
}

export type OneBot12BotConfig = OneBot12WsConfig | OneBot12WebhookConfig | OneBot12WssConfig;

/** 机器人自身标识（事件与动作中的 self） */
export interface OneBot12Self {
  platform: string;
  user_id: string;
}

/** 事件（实现推送给应用） */
export interface OneBot12Event {
  id: string;
  time: number;
  type: 'meta' | 'message' | 'notice' | 'request';
  detail_type: string;
  sub_type: string;
  self?: OneBot12Self;
  message_id?: string;
  message?: OneBot12Segment[];
  alt_message?: string;
  user_id?: string;
  group_id?: string;
  channel_id?: string;
  guild_id?: string;
  [key: string]: unknown;
}

/** 消息段 */
export interface OneBot12Segment {
  type: string;
  data?: Record<string, unknown>;
}

/** 动作请求（应用发给实现） */
export interface OneBot12ActionRequest {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
  self?: OneBot12Self;
}

/** 动作响应（实现返回给应用） */
export interface OneBot12ActionResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data?: unknown;
  message: string;
  echo?: string;
}
