/**
 * KOOK 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { KookBot } from "./bot.js";
import type { KookBotConfig } from "./types.js";

export class KookAdapter extends Adapter<KookBot> {
  constructor(plugin: Plugin) {
    super(plugin, "kook", []);
  }

  createBot(config: KookBotConfig): KookBot {
    return new KookBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickUser(sceneId, userId);
  }

  async banMember(botId: string, sceneId: string, userId: string, reason?: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.addToBlacklist(sceneId, userId, reason);
  }

  async unbanMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.removeFromBlacklist(sceneId, userId);
  }

  async setMemberNickname(botId: string, sceneId: string, userId: string, nickname: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setNickname(sceneId, userId, nickname);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    const members = await bot.getGuildMembers(sceneId);
    return {
      members: members.map(m => ({
        id: m.id, username: m.username,
        nickname: m.nickname, roles: m.roles,
      })),
      count: members.length,
    };
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
    this.plugin.logger.info("KOOK 适配器已启动");
  }

  async stop(): Promise<void> {
    await super.stop();
    this.plugin.logger.info("KOOK 适配器已停止");
  }
}

