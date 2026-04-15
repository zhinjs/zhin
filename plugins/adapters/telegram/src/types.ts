/**
 * Telegram 适配器类型定义
 */
import type { Message as TelegramMessage } from "telegraf/types";

export type { TelegramMessage };

export interface TelegramSenderInfo {
  id: string;
  name: string;
  username?: string;
  isOwner?: boolean;
  isAdmin?: boolean;
  status?: string;
}

export interface TelegramBotConfig {
  context: "telegram";
  token: string;
  name: string;
  polling?: boolean;
  webhook?: {
    domain: string;
    path?: string;
    port?: number;
  };
  allowedUpdates?: string[];
}

export interface TelegramBot {
  $config: TelegramBotConfig;
}
