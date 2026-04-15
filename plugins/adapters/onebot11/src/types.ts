/**
 * OneBot11 适配器类型与配置
 */


export interface OneBot11SenderInfo {
  id: string;
  name: string;
  role?: 'owner' | 'admin' | 'member';
  isOwner?: boolean;
  isAdmin?: boolean;
  card?: string;
  title?: string;
}

/** 配置公共字段；单一适配器 context 均为 'onebot11'，连接方式由 connection 区分 */
export interface OneBot11ConfigBase {
  context: 'onebot11';
  name: string;
  access_token?: string;
}

/** 正向 WebSocket：应用连 OneBot 实现的 WS */
export interface OneBot11WsClientConfig extends OneBot11ConfigBase {
  connection: 'ws';
  url: string;
  reconnect_interval?: number;
  heartbeat_interval?: number;
}

/** 反向 WebSocket：应用开 WS 服务端，实现连上来 */
export interface OneBot11WsServerConfig extends OneBot11ConfigBase {
  connection: 'wss';
  path: string;
  heartbeat_interval?: number;
}

export type OneBot11BotConfig = OneBot11WsClientConfig | OneBot11WsServerConfig;

export interface OneBot11Message {
  post_type: string;
  self_id: string;
  message_type?: string;
  sub_type?: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: Array<{ type: string; data: Record<string, any> }>;
  raw_message: string;
  time: number;
}

export interface ApiResponse<T = any> {
  status: string;
  retcode: number;
  data: T;
  echo?: string;
}
