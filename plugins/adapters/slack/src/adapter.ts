/**
 * Slack 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { SlackBot } from "./bot.js";
import type { SlackBotConfig } from "./types.js";

export class SlackAdapter extends Adapter<SlackBot> {
  constructor(plugin: Plugin) {
    super(plugin, "slack", []);
  }

  createBot(config: SlackBotConfig): SlackBot {
    return new SlackBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickFromChannel(sceneId, userId);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.renameChannel(sceneId, name);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChannelMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChannelInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }

}
