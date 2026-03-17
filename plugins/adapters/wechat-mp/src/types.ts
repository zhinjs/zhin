/**
 * 微信公众号适配器类型定义
 */
export interface WeChatMPConfig {
  context: "wechat-mp";
  name: string;
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey?: string;
  path: string;
  encrypt?: boolean;
}

export interface WeChatMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: string;
  MsgId?: string;
  Content?: string;
  PicUrl?: string;
  MediaId?: string;
  Format?: string;
  Recognition?: string;
  ThumbMediaId?: string;
  Location_X?: string;
  Location_Y?: string;
  Scale?: string;
  Label?: string;
  Title?: string;
  Description?: string;
  Url?: string;
  Event?: string;
  EventKey?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface WeChatAPIResponse {
  errcode?: number;
  errmsg?: string;
}
