/**
 * 钉钉适配器类型定义
 */

export interface DingTalkBotConfig {
  context: "dingtalk";
  name: string;
  appKey: string;
  appSecret: string;
  webhookPath: string;
  robotCode?: string;
  apiBaseUrl?: string;
}

export interface DingTalkMessage {
  msgtype?: string;
  text?: { content?: string };
  msgId?: string;
  createAt?: number;
  conversationType?: string;
  conversationId?: string;
  senderId?: string;
  senderNick?: string;
  senderCorpId?: string;
  sessionWebhook?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  isAdmin?: boolean;
  senderStaffId?: string;
  atUsers?: Array<{ dingtalkId?: string; staffId?: string }>;
  content?: any;
}

export interface DingTalkEvent {
  msgtype?: string;
  text?: any;
  conversationId?: string;
  atUsers?: any[];
  chatbotUserId?: string;
  msgId?: string;
  senderNick?: string;
  isAdmin?: boolean;
  senderStaffId?: string;
  sessionWebhook?: string;
  createAt?: number;
  senderCorpId?: string;
  conversationType?: string;
  senderId?: string;
  [key: string]: any;
}

export interface AccessToken {
  token: string;
  expires_in: number;
  timestamp: number;
}
