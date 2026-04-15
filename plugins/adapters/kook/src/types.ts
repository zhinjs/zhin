/**
 * KOOK 适配器类型与配置
 */
import type { PrivateMessageEvent, ChannelMessageEvent } from "kook-client";
import type { LogLevel } from "kook-client";

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
}

export interface KookBotConfig {
  context: "kook";
  name: string;
  token: string;
  data_dir?: string;
  timeout?: number;
  max_retry?: number;
  ignore?: "bot" | "self";
  logLevel?: LogLevel;
}

export type KookRawMessage = PrivateMessageEvent | ChannelMessageEvent;
