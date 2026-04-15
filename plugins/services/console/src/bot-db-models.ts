/**
 * 控制台机器人请求/通知的数据库表定义，供 zhin 内置数据库使用
 */
import type { Definition } from "@zhin.js/core";

export interface ConsoleBotRequestRow {
  id?: number;
  adapter: string;
  bot_id: string;
  platform_request_id: string;
  type: string;
  sender_id: string;
  sender_name: string;
  comment: string;
  channel_id: string;
  channel_type: string;
  created_at: number;
  consumed: number;
  consumed_at?: number;
}

export interface ConsoleBotNoticeRow {
  id?: number;
  adapter: string;
  bot_id: string;
  notice_type: string;
  channel_type: string;
  channel_id: string;
  payload: string;
  created_at: number;
  consumed: number;
  consumed_at?: number;
}

export const ConsoleBotRequestDefinition: Definition<ConsoleBotRequestRow> = {
  id: { type: "integer", primary: true, autoIncrement: true },
  adapter: { type: "text", nullable: false },
  bot_id: { type: "text", nullable: false },
  platform_request_id: { type: "text", nullable: false },
  type: { type: "text", nullable: false },
  sender_id: { type: "text", nullable: false },
  sender_name: { type: "text", nullable: false },
  comment: { type: "text", nullable: false },
  channel_id: { type: "text", nullable: false },
  channel_type: { type: "text", nullable: false },
  created_at: { type: "integer", nullable: false },
  consumed: { type: "integer", nullable: false, default: 0 },
  consumed_at: { type: "integer", nullable: true },
};

export const ConsoleBotNoticeDefinition: Definition<ConsoleBotNoticeRow> = {
  id: { type: "integer", primary: true, autoIncrement: true },
  adapter: { type: "text", nullable: false },
  bot_id: { type: "text", nullable: false },
  notice_type: { type: "text", nullable: false },
  channel_type: { type: "text", nullable: false },
  channel_id: { type: "text", nullable: false },
  payload: { type: "text", nullable: false },
  created_at: { type: "integer", nullable: false },
  consumed: { type: "integer", nullable: false, default: 0 },
  consumed_at: { type: "integer", nullable: true },
};

const TABLE_REQUESTS = "console_bot_requests";
const TABLE_NOTICES = "console_bot_notices";

export function registerBotModels(root: { defineModel?: (name: string, def: Definition<unknown>) => void }) {
  const defineModel = root.defineModel;
  if (typeof defineModel !== "function") return;
  defineModel(TABLE_REQUESTS, ConsoleBotRequestDefinition as Definition<unknown>);
  defineModel(TABLE_NOTICES, ConsoleBotNoticeDefinition as Definition<unknown>);
}

export { TABLE_REQUESTS, TABLE_NOTICES };
