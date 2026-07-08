export interface WeixinIlinkEndpointConfig {
  context: "weixin-ilink";
  name: string;
  /** 观测用 bot_agent，默认 Zhin.js/<version> */
  botAgent?: string;
  /** iLink API 根地址，默认 https://ilinkai.weixin.qq.com */
  baseUrl?: string;
  /** CDN 根地址 */
  cdnBaseUrl?: string;
  /** 长轮询超时（ms），默认 35000 */
  longPollTimeoutMs?: number;
  /** 直接配置 token（优先于侧车凭证文件） */
  botToken?: string;
}

export type { WeixinMessage, MessageItem } from "./ilink-types.js";
