/**
 * 飞书/Lark 适配器类型定义
 */
export interface LarkBotConfig {
  context: "lark";
  name: string;
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  webhookPath: string;
  apiBaseUrl?: string;
  isFeishu?: boolean;
}

export interface LarkMessage {
  message_id?: string;
  root_id?: string;
  parent_id?: string;
  create_time?: string;
  update_time?: string;
  chat_id?: string;
  sender?: {
    sender_id?: { user_id?: string; open_id?: string; union_id?: string };
    sender_type?: string;
    tenant_key?: string;
  };
  message_type?: string;
  content?: string;
  mentions?: Array<{
    key?: string;
    id?: { user_id?: string; open_id?: string; union_id?: string };
    name?: string;
    tenant_key?: string;
  }>;
}

export interface LarkEvent {
  uuid?: string;
  token?: string;
  ts?: string;
  type?: string;
  event?: {
    sender?: any;
    message?: LarkMessage;
    [key: string]: any;
  };
}

export interface AccessToken {
  token: string;
  expires_in: number;
  timestamp: number;
}

export interface LarkBot {
  $config: LarkBotConfig;
}
