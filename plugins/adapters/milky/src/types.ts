/**
 * Milky 适配器类型与配置（与官方文档一致）
 */

/** 配置公共字段；单一适配器下 context 均为 'milky'，连接方式由 connection 区分 */
export interface MilkyConfigBase {
  context: 'milky';
  name: string;
  baseUrl: string;
  access_token?: string;
}

/** WebSocket 正向连接 */
export interface MilkyWsConfig extends MilkyConfigBase {
  connection: 'ws';
  reconnect_interval?: number;
  heartbeat_interval?: number;
}

/** SSE 连接 */
export interface MilkySseConfig extends MilkyConfigBase {
  connection: 'sse';
}

/** Webhook（协议端 POST 到应用） */
export interface MilkyWebhookConfig extends MilkyConfigBase {
  connection: 'webhook';
  path: string;
}

/** WebSocket 反向（协议端连应用） */
export interface MilkyWssConfig extends MilkyConfigBase {
  connection: 'wss';
  path: string;
  heartbeat_interval?: number;
}

export type MilkyBotConfig = MilkyWsConfig | MilkySseConfig | MilkyWebhookConfig | MilkyWssConfig;

/** 协议端 API 响应：status、retcode、data?、message? */
export interface MilkyApiResponse<T = unknown> {
  status: string;
  retcode: number;
  data?: T;
  message?: string;
}

/** 事件结构：event_type、time、self_id、data */
export interface MilkyEvent {
  event_type: string;
  time: number;
  self_id: number;
  data?: Record<string, unknown>;
}

/** 接收消息 data（message_receive）：message_scene、peer_id、message_seq、sender_id、time、segments、可选 friend/group/group_member */
export interface MilkyIncomingMessage {
  message_scene: 'friend' | 'group' | 'temp';
  peer_id: number;
  message_seq: number;
  sender_id: number;
  time: number;
  segments: MilkyIncomingSegment[];
  friend?: { user_id: number; nickname?: string };
  group?: { group_id: number; group_name?: string };
  group_member?: { user_id: number; nickname?: string; card?: string; role?: string };
}

/** 接收消息段：type、data */
export interface MilkyIncomingSegment {
  type: string;
  data?: Record<string, unknown>;
}
