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
  /**
   * plain：明文入站/出站
   * compatible：入站可解密，被动回复用明文（微信兼容模式推荐）
   * secure：入站/出站均加密
   */
  encryptMode?: "plain" | "compatible" | "secure";
  /**
   * passive：订阅号默认，在 webhook 响应内被动回复（5 秒内）
   * customer_service：走客服消息 API（需接口权限）
   */
  replyMode?: "passive" | "customer_service";
  /** 被动回复等待入站处理的最长时间（毫秒），默认 4500 */
  passiveReplyTimeoutMs?: number;
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
  msgid?: number;
}
