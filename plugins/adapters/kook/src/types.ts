/**
 * KOOK 适配器类型与配置
 */
import { type PrivateMessageEvent, type ChannelMessageEvent, type LogLevel } from 'kook-client';

export type { LogLevel };

export enum KookPermission {
  Normal = 1,
  Admin = 2,
  Owner = 4,
  ChannelAdmin = 5,
}

export interface KookSenderInfo {
  id: string;
  name: string;
  permission?: KookPermission;
  roles?: number[];
  isGuildOwner?: boolean;
  isAdmin?: boolean;
  /** 归一化平台身份（供 platform checker） */
  role?: string;
  permissions?: string[];
}

export interface KookTypingIndicatorConfig {
  enabled?: boolean;
  defaultEmoji?: string;
  autoRemove?: boolean;
  removeDelay?: number;
  privateConfig?: {
    type?: 'reaction' | 'message' | 'typing' | 'none';
    emoji?: string;
    message?: string;
  };
  /** 频道/群聊（KOOK channel 走 groupConfig 合并逻辑） */
  groupConfig?: {
    type?: 'reaction' | 'message' | 'typing' | 'none';
    emoji?: string;
    message?: string;
  };
}

export interface KookEndpointConfig {
  context: "kook";
  name: string;
  token: string;
  data_dir?: string;
  timeout?: number;
  max_retry?: number;
  ignore?: "bot" | "self";
  logLevel?: LogLevel;
  /** AI 处理中提示（reaction 推荐：不打断会话） */
  typingIndicator?: KookTypingIndicatorConfig;
}

export type KookRawMessage = PrivateMessageEvent | ChannelMessageEvent;
