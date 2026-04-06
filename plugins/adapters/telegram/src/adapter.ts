/**
 * Telegram 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { TelegramBot } from "./bot.js";
import type { TelegramBotConfig } from "./types.js";

export class TelegramAdapter extends Adapter<TelegramBot> {
  constructor(plugin: Plugin) {
    super(plugin, "telegram", []);
  }

  createBot(config: TelegramBotConfig): TelegramBot {
    return new TelegramBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickMember(Number(sceneId), Number(userId));
  }

  async unbanMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.unbanMember(Number(sceneId), Number(userId));
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteMember(Number(sceneId), Number(userId), duration);
  }

  async setAdmin(botId: string, sceneId: string, userId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setChatTitle(Number(sceneId), name);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChatInfo(Number(sceneId));
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }
}

