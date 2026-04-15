/**
 * Discord 适配器：单一适配器支持 Gateway / Interactions，由 config.connection 区分
 */
import type { Router } from "@zhin.js/http";
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { DiscordBot } from "./bot.js";
import { DiscordInteractionsBot } from "./bot-interactions.js";
import type {
  DiscordBotConfig,
  DiscordGatewayConfig,
  DiscordInteractionsConfig,
} from "./types.js";

export type DiscordBotLike = DiscordBot | DiscordInteractionsBot;

function isGatewayBot(bot: DiscordBotLike): bot is DiscordBot {
  return (bot.$config as { connection?: string }).connection === "gateway";
}

export class DiscordAdapter extends Adapter<DiscordBotLike> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, "discord", []);
  }

  createBot(config: DiscordBotConfig): DiscordBotLike {
    const connection = config.connection ?? "gateway";
    switch (connection) {
      case "gateway":
        return new DiscordBot(this, config as DiscordGatewayConfig);
      case "interactions":
        if (!this.#router) {
          throw new Error(
            "Discord connection: interactions 需要 router，请安装并在配置中启用 @zhin.js/http"
          );
        }
        return new DiscordInteractionsBot(this, this.#router, config as DiscordInteractionsConfig);
      default:
        throw new Error(`Unknown Discord connection: ${(config as DiscordBotConfig).connection}`);
    }
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.kickMember(sceneId, userId);
  }

  async banMember(botId: string, sceneId: string, userId: string, reason?: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.banMember(sceneId, userId, reason);
  }

  async unbanMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.unbanMember(sceneId, userId);
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.timeoutMember(sceneId, userId, duration);
  }

  async setMemberNickname(botId: string, sceneId: string, userId: string, nickname: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.setNickname(sceneId, userId, nickname);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.getMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    if (!isGatewayBot(bot)) throw new Error("群管仅支持 connection: gateway");
    return bot.getGuildInfo(sceneId);
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)("router");
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)(
      "router",
      (router: Router) => {
        this.#router = router;
      }
    );
    await super.start();
  }

}
