/**
 * ICQQ 适配器
 */
import type { MemberInfo } from "@icqqjs/icqq";
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { IcqqBot } from "./bot.js";
import type { IcqqBotConfig } from "./types.js";

export class IcqqAdapter extends Adapter<IcqqBot> {
  constructor(plugin: Plugin) {
    super(plugin, "icqq", []);
  }

  createBot(config: IcqqBotConfig): IcqqBot {
    return new IcqqBot(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickMember(Number(sceneId), Number(userId), false);
  }

  async muteMember(
    botId: string,
    sceneId: string,
    userId: string,
    duration = 600,
  ) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteMember(Number(sceneId), Number(userId), duration);
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteAll(Number(sceneId), enable);
  }

  async setAdmin(
    botId: string,
    sceneId: string,
    userId: string,
    enable = true,
  ) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(
    botId: string,
    sceneId: string,
    userId: string,
    nickname: string,
  ) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setCard(Number(sceneId), Number(userId), nickname);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setGroupName(Number(sceneId), name);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    const memberMap = await bot.getMemberList(Number(sceneId));
    const members = Array.from(memberMap.values()).map((m: MemberInfo) => ({
      user_id: m.user_id,
      nickname: m.nickname,
      card: m.card,
      role: m.role,
      title: m.title,
    }));
    return { members, count: members.length };
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }

}
