/**
 * ICQQ 适配器 — 通过 @icqqjs/cli 守护进程 IPC 管理 Bot 实例
 */
import { Adapter, Plugin } from "zhin.js";
import { IcqqBot } from "./bot.js";
import type { IcqqBotConfig, IpcMemberInfo } from "./types.js";
import { Actions } from "./protocol.js";

export class IcqqAdapter extends Adapter<IcqqBot> {
  constructor(plugin: Plugin) {
    super(plugin, "icqq", []);
  }

  createBot(config: IcqqBotConfig): IcqqBot {
    return new IcqqBot(this, config);
  }

  async start(): Promise<void> {
    await super.start();
    this.logger.info("ICQQ 适配器已启动");
  }

  async stop(): Promise<void> {
    await super.stop();
    this.logger.info("ICQQ 适配器已停止");
  }

  // ── IGroupManagement 标准群管方法（通过 IPC） ─────────────────────

  private getBot(botId: string): IcqqBot {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot;
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.GROUP_KICK, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      reject_add_request: false,
    });
    if (!resp.ok) throw new Error(resp.error ?? "踢人失败");
    return true;
  }

  async muteMember(
    botId: string,
    sceneId: string,
    userId: string,
    duration = 600,
  ) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.GROUP_MUTE, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      duration,
    });
    if (!resp.ok) throw new Error(resp.error ?? "禁言失败");
    return true;
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.GROUP_MUTE_ALL, {
      group_id: Number(sceneId),
      enable,
    });
    if (!resp.ok) throw new Error(resp.error ?? "全员禁言失败");
    return true;
  }

  async setAdmin(
    botId: string,
    sceneId: string,
    userId: string,
    enable = true,
  ) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.SET_GROUP_ADMIN, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      enable,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置管理员失败");
    return true;
  }

  async setMemberNickname(
    botId: string,
    sceneId: string,
    userId: string,
    nickname: string,
  ) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.SET_GROUP_CARD, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      card: nickname,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置群名片失败");
    return true;
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.SET_GROUP_NAME, {
      group_id: Number(sceneId),
      name,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置群名失败");
    return true;
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.getBot(botId);
    const resp = await bot.ipc.request(Actions.LIST_GROUP_MEMBERS, {
      group_id: Number(sceneId),
    });
    if (!resp.ok) throw new Error(resp.error ?? "获取成员列表失败");
    const raw = resp.data as IpcMemberInfo[];
    const members = raw.map((m) => ({
      user_id: m.user_id,
      nickname: m.nickname,
      card: m.card,
      role: m.role,
      title: m.title,
    }));
    return { members, count: members.length };
  }

}
