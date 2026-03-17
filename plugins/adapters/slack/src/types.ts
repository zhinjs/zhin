/**
 * Slack 适配器类型定义
 */
import type { LogLevel } from "@slack/bolt";
import type { KnownEventFromType } from "@slack/bolt";

export interface SlackBotConfig {
  context: "slack";
  token: string;
  name: string;
  signingSecret: string;
  appToken?: string;
  socketMode?: boolean;
  port?: number;
  logLevel?: LogLevel;
}

export type SlackMessageEvent = KnownEventFromType<"message">;
