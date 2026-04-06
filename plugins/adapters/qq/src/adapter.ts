/**
 * QQ 官方适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { QQBot } from "./bot.js";
import type { QQBotConfig, ReceiverMode } from "./types.js";

export class QQAdapter extends Adapter<QQBot<ReceiverMode>> {
  constructor(plugin: Plugin) {
    super(plugin, "qq", []);
  }

  createBot(config: QQBotConfig<ReceiverMode>): QQBot<ReceiverMode> {
    return new QQBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.removeGuildMember(sceneId, userId, false);
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteMembers(sceneId, [userId], duration);
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteAll(sceneId, enable ? 600 : 0);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGuildMembers(sceneId);
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGuildInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }

}
