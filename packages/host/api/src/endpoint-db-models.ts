/**
 * 控制台机器人请求/通知的数据库表定义，供 zhin 内置数据库使用
 */
import type { Definition } from "@zhin.js/core";

export interface ConsoleBotRequestRow {
  id?: number;
  adapter: string;
  endpoint_id: string;
  platform_request_id: string;
  type: string;
  scene_type: string;
  scene_id: string;
  sub_type: string;
  actor_id: string;
  actor_name: string;
  comment: string;
  created_at: number;
  consumed: number;
  consumed_at?: number;
}

export interface ConsoleBotNoticeRow {
  id?: number;
  adapter: string;
  endpoint_id: string;
  platform_notice_id: string;
  type: string;
  scene_type: string;
  scene_id: string;
  sub_type: string;
  actor_id: string;
  actor_name: string;
  target_id: string;
  target_name: string;
  payload: string;
  created_at: number;
  consumed: number;
  consumed_at?: number;
}

export const ConsoleBotRequestDefinition: Definition<ConsoleBotRequestRow> = {
  id: { type: "integer", primary: true, autoIncrement: true },
  adapter: { type: "text", nullable: false },
  endpoint_id: { type: "text", nullable: false },
  platform_request_id: { type: "text", nullable: false },
  type: { type: "text", nullable: false },
  scene_type: { type: "text", nullable: false, default: "" },
  scene_id: { type: "text", nullable: false },
  sub_type: { type: "text", nullable: false, default: "" },
  actor_id: { type: "text", nullable: false },
  actor_name: { type: "text", nullable: false, default: "" },
  comment: { type: "text", nullable: false, default: "" },
  created_at: { type: "integer", nullable: false },
  consumed: { type: "integer", nullable: false, default: 0 },
  consumed_at: { type: "integer", nullable: true },
};

export const ConsoleBotNoticeDefinition: Definition<ConsoleBotNoticeRow> = {
  id: { type: "integer", primary: true, autoIncrement: true },
  adapter: { type: "text", nullable: false },
  endpoint_id: { type: "text", nullable: false },
  platform_notice_id: { type: "text", nullable: false, default: "" },
  type: { type: "text", nullable: false },
  scene_type: { type: "text", nullable: false, default: "" },
  scene_id: { type: "text", nullable: false },
  sub_type: { type: "text", nullable: false, default: "" },
  actor_id: { type: "text", nullable: false, default: "" },
  actor_name: { type: "text", nullable: false, default: "" },
  target_id: { type: "text", nullable: false, default: "" },
  target_name: { type: "text", nullable: false, default: "" },
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
