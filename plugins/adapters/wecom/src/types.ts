/**
 * 企业微信适配器类型定义
 */

export interface WecomEndpointConfig {
  context: 'wecom'
  name: string
  corpId: string
  agentId: string
  token: string           // 用于签名验证
  encodingAESKey: string  // 用于消息加解密
  webhookPath?: string    // 默认 '/wecom/callback'
  apiBaseUrl?: string     // 默认 'https://qyapi.weixin.qq.com'
}

export interface WecomMessage {
  ToUserName: string
  FromUserName: string
  CreateTime: number
  MsgType: 'text' | 'image' | 'voice' | 'video' | 'shortvideo' | 'location' | 'link' | 'event'
  Content?: string
  MsgId?: string
  PicUrl?: string
  MediaId?: string
  ThumbMediaId?: string
  Format?: string
  Recognition?: string
  Location_X?: string
  Location_Y?: string
  Scale?: string
  Label?: string
  Title?: string
  Description?: string
  Url?: string
  Event?: string
  EventKey?: string
  AgentID?: string
  [key: string]: unknown
}

export interface AccessToken {
  access_token: string
  expires_in: number
  timestamp: number
}
