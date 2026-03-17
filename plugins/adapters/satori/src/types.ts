/**
 * Satori 适配器类型（参考 https://satori.chat 协议）
 */

/** 配置公共字段；单一适配器 context 均为 'satori'，连接方式由 connection 区分 */
export interface SatoriConfigBase {
  context: 'satori';
  name: string;
  baseUrl: string;
  /** 认证 token，API 用 Authorization: Bearer，WebSocket IDENTIFY 用 token 字段 */
  token?: string;
}

/** WebSocket 连接（应用连 SDK /v1/events） */
export interface SatoriWsConfig extends SatoriConfigBase {
  connection: 'ws';
  /** 心跳间隔（毫秒），默认 10000 */
  heartbeat_interval?: number;
}

/** WebHook（SDK POST 到应用提供的 path） */
export interface SatoriWebhookConfig extends SatoriConfigBase {
  connection: 'webhook';
  path: string;
}

export type SatoriBotConfig = SatoriWsConfig | SatoriWebhookConfig;

/** WebSocket/API 信号：op + body */
export interface SatoriSignal {
  op: number;
  body?: Record<string, unknown>;
}

/** Opcode：EVENT=0, PING=1, PONG=2, IDENTIFY=3, READY=4, META=5 */
export const SatoriOpcode = {
  EVENT: 0,
  PING: 1,
  PONG: 2,
  IDENTIFY: 3,
  READY: 4,
  META: 5,
} as const;

/** 事件体（EVENT 的 body）：type、sn、timestamp、login、message、channel、user 等 */
export interface SatoriEventBody {
  type?: string;
  sn?: number;
  timestamp?: number;
  login?: SatoriLogin;
  message?: SatoriMessage;
  channel?: SatoriChannel;
  user?: SatoriUser;
  guild?: { id: string; name?: string };
  member?: { user?: SatoriUser; nick?: string; roles?: string[] };
  [key: string]: unknown;
}

/** Login 资源（READY 与事件中） */
export interface SatoriLogin {
  platform?: string;
  user?: SatoriUser;
  status?: number;
  sn?: number;
}

/** Channel 资源：id, type (0=TEXT,1=DIRECT,2=CATEGORY,3=VOICE) */
export interface SatoriChannel {
  id: string;
  type?: number;
  name?: string;
  parent_id?: string;
}

/** User 资源 */
export interface SatoriUser {
  id: string;
  name?: string;
  avatar?: string;
}

/** Message 资源：id, content（元素字符串）, channel, user 等 */
export interface SatoriMessage {
  id: string;
  content?: string;
  channel?: SatoriChannel;
  user?: SatoriUser;
  member?: { user?: SatoriUser; nick?: string };
  created_at?: number;
  updated_at?: number;
}
