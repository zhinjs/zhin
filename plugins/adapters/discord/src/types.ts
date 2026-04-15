/**
 * Discord 适配器类型定义：单一适配器，connection 区分 Gateway / Interactions
 */
import type {
  Message as DiscordMessage,
  GatewayIntentBits,
  ApplicationCommandData,
} from "discord.js";

export type { GatewayIntentBits, ApplicationCommandData };

/** 配置公共字段；单一适配器 context 均为 'discord'，连接方式由 connection 区分 */
export interface DiscordConfigBase {
  context: "discord";
  name: string;
  token: string;
}

/** Gateway 连接：常规 WebSocket 网关 */
export interface DiscordGatewayConfig extends DiscordConfigBase {
  connection: "gateway";
  intents?: GatewayIntentBits[];
  enableSlashCommands?: boolean;
  globalCommands?: boolean;
  defaultActivity?: {
    name: string;
    type: "PLAYING" | "STREAMING" | "LISTENING" | "WATCHING" | "COMPETING";
    url?: string;
  };
  slashCommands?: ApplicationCommandData[];
}

/** Interactions 连接：HTTP 交互端点（斜杠命令等） */
export interface DiscordInteractionsConfig extends DiscordConfigBase {
  connection: "interactions";
  applicationId: string;
  publicKey: string;
  interactionsPath: string;
  useGateway?: boolean;
  intents?: GatewayIntentBits[];
  slashCommands?: ApplicationCommandData[];
  globalCommands?: boolean;
  defaultActivity?: {
    name: string;
    type: "PLAYING" | "STREAMING" | "LISTENING" | "WATCHING" | "COMPETING";
    url?: string;
  };
}

export type DiscordBotConfig = DiscordGatewayConfig | DiscordInteractionsConfig;

export interface DiscordBot {
  $config: DiscordGatewayConfig;
}

export interface DiscordInteractionsBot {
  $config: DiscordInteractionsConfig;
}

export type DiscordChannelMessage = DiscordMessage<boolean>;
