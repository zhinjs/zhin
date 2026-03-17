/**
 * ICQQ 适配器
 */
import type { MemberInfo } from "@icqqjs/icqq";
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  GROUP_MANAGEMENT_SKILL_KEYWORDS,
  GROUP_MANAGEMENT_SKILL_TAGS,
  type IGroupManagement,
  type ToolPermissionLevel,
} from "zhin.js";
import { IcqqBot } from "./bot.js";
import type { IcqqBotConfig, IcqqSenderInfo } from "./types.js";

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
    this.registerIcqqPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    this.declareSkill({
      description:
        'ICQQ（QQ 协议）群管理：踢人、禁言、设管理员、改名片、头衔、群公告等。只有昵称时请先调用 list_members 查 QQ 号再操作。',
      keywords: GROUP_MANAGEMENT_SKILL_KEYWORDS,
      tags: GROUP_MANAGEMENT_SKILL_TAGS,
    });
    await super.start();
  }

  /**
   * 注册 ICQQ 平台特有工具（头衔、戳一戳、群公告等）
   */
  private registerIcqqPlatformTools(): void {
    const CTX_BOT = {
      type: "string" as const,
      description: "执行操作的 Bot QQ号",
      contextKey: "botId" as const,
    };
    const CTX_GROUP = {
      type: "number" as const,
      description: "目标群号",
      contextKey: "sceneId" as const,
    };

    // 设置头衔工具
    this.addTool({
      name: "icqq_set_title",
      description:
        "设置 QQ 群成员的专属头衔（显示在群昵称旁边的标签）。只有群主才能操作。可设置持续时间或永久。如果只有昵称没有 QQ号，请先调用 list_members 查询。",
      tags: ["群管理", "成员管理", "头衔"],
      keywords: ["头衔", "专属头衔", "设置头衔", "给头衔", "加头衔", "称号"],
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: "number",
            description: "目标成员 QQ号",
          },
          title: {
            type: "string",
            description: "头衔文字内容",
          },
          duration: {
            type: "number",
            description: "持续时间（秒），-1 表示永久，默认永久",
          },
        },
        required: ["bot", "group_id", "user_id", "title"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "group_owner",
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, title, duration = -1 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);

        this.checkPermission(context, "group_owner");

        const success = await bot.setTitle(group_id, user_id, title, duration);
        return {
          success,
          message: success
            ? `已将 ${user_id} 的头衔设为 "${title}"`
            : "设置失败",
        };
      },
    });

    // 发送群公告工具
    this.addTool({
      name: "icqq_announce",
      description: "发送 QQ 群公告（需要管理员权限）",
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          content: {
            type: "string",
            description: "公告内容",
          },
        },
        required: ["bot", "group_id", "content"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "group_admin",
      execute: async (args, context) => {
        const { bot: botId, group_id, content } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);

        this.checkPermission(context, "group_admin");

        const success = await bot.sendAnnounce(group_id, content);
        return { success, message: success ? "群公告已发送" : "发送失败" };
      },
    });

    // 戳一戳工具
    this.addTool({
      name: "icqq_poke",
      description:
        '在 QQ 群中对某个成员执行"戳一戳"互动操作（类似拍一拍）。任何人都可以使用。注意：每次请求只戳一次，不要重复调用此工具。如果只有昵称没有 QQ号，请先调用 list_members 查询。',
      tags: ["互动", "趣味", "戳一戳"],
      keywords: ["戳", "戳一戳", "拍一拍", "拍", "碰一碰", "poke"],
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: "number",
            description: "要戳的目标成员 QQ号",
          },
        },
        required: ["bot", "group_id", "user_id"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, group_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);

        const success = await bot.pokeMember(group_id, user_id);
        return {
          success,
          message: success ? `已戳了戳 ${user_id}` : "戳一戳失败",
        };
      },
    });

    // 获取被禁言列表工具
    this.addTool({
      name: "icqq_list_muted",
      description:
        "查询 QQ 群中当前被禁言的成员列表，返回被禁言成员的 QQ号和剩余禁言时间。此工具仅用于查询，不会执行禁言操作。如需禁言或解除禁言，请使用 icqq_mute_member 工具。",
      tags: ["群查询", "禁言查询", "列表"],
      keywords: ["禁言列表", "被禁言", "谁被禁言", "查看禁言", "禁言名单"],
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
        },
        required: ["bot", "group_id"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);

        const mutedList = await bot.getMutedMembers(group_id);
        return {
          muted_members: mutedList.filter((m) => m !== null),
          count: mutedList.filter((m) => m !== null).length,
        };
      },
    });
    this.addTool({
      name: "icqq_send_user_like",
      description: "给用户点赞（竖大拇指）。每人每天最多点赞 20 次，超出无效。如果只有昵称没有 QQ号，请先调用 list_members 查询。",
      tags: ["互动", "趣味", "点赞"],
      keywords: ["点赞", "赞我", "赞一下", "大拇指"],
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          user_id: {
            type: "number",
            description: "要点赞的目标用户 QQ号（如果只有昵称，先用 list_members 查询获取）",
          },
          times: {
            type: "number",
            description: "点赞次数（1-20），默认 1 次，每人每天上限 20 次",
            default: 1,
          },
        },
        required: ["bot", "user_id"],
      },
      platforms: ["icqq"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, user_id, times = 1 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.sendLike(user_id, Math.min(times, 20));
        return {
          success,
          message: success ? `已发送用户点赞消息给 ${user_id}` : "发送失败",
        };
      },
    });
    // 设置匿名状态工具
    this.addTool({
      name: "icqq_set_anonymous",
      description:
        "开启或关闭 QQ 群的匿名聊天功能。开启后群成员可以匿名发言。需要 Bot 拥有管理员权限。",
      tags: ["群管理", "群设置", "匿名"],
      keywords: ["匿名", "匿名聊天", "开启匿名", "关闭匿名", "允许匿名"],
      parameters: {
        type: "object",
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          enable: {
            type: "boolean",
            description: "true=开启匿名聊天，false=关闭匿名聊天，默认 true",
          },
        },
        required: ["bot", "group_id"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "group_admin",
      execute: async (args, context) => {
        const { bot: botId, group_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);

        this.checkPermission(context, "group_admin");

        const success = await bot.setAnonymous(group_id, enable);
        return {
          success,
          message: success
            ? enable
              ? "已开启匿名聊天"
              : "已关闭匿名聊天"
            : "操作失败",
        };
      },
    });

    // 群文件列表
    this.addTool({
      name: "icqq_group_files",
      description: "获取 QQ 群的群文件列表",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          group_id: { type: "number", description: "群号" },
        },
        required: ["bot", "group_id"],
      },
      platforms: ["icqq"],
      scopes: ["group"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const files = await bot.getGroupFiles(group_id);
        if (!files?.length) return { files: [], message: "群文件为空" };
        return {
          files: files.slice(0, 30).map((f: any) => ({
            name: f.name,
            size: f.size,
            uploader: f.uploader_uin,
            upload_time: f.upload_time,
          })),
          count: files.length,
        };
      },
    });

    // 好友列表
    this.addTool({
      name: "icqq_friend_list",
      description: "获取 QQ 好友列表",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
        },
        required: ["bot"],
      },
      platforms: ["icqq"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const fl = bot.fl;
        const friends = Array.from(fl.values()).map((f: any) => ({
          user_id: f.user_id,
          nickname: f.nickname,
          remark: f.remark,
        }));
        return { friends: friends.slice(0, 50), count: fl.size };
      },
    });

    this.plugin.logger.debug("已注册 ICQQ 平台群管理工具");
  }

  /**
   * 检查执行上下文中的权限
   * 双重验证：优先从 ToolContext 获取权限级别，其次从消息发送者信息获取
   */
  private checkPermission(context: any, required: ToolPermissionLevel): void {
    const permissionLevels: Record<ToolPermissionLevel, number> = {
      user: 0,
      group_admin: 1,
      group_owner: 2,
      bot_admin: 3,
      owner: 4,
    };

    const requiredLevel = permissionLevels[required] ?? 0;
    if (requiredLevel === 0) return; // user 级别无需检查

    // 1. 优先从 ToolContext.senderPermissionLevel 获取（AI Agent 路径注入）
    if (context?.senderPermissionLevel) {
      const ctxLevel =
        permissionLevels[
          context.senderPermissionLevel as ToolPermissionLevel
        ] ?? 0;
      if (ctxLevel < requiredLevel) {
        throw new Error(
          `权限不足：需要 ${required} 权限，当前为 ${context.senderPermissionLevel}`,
        );
      }
      return; // 检查通过
    }

    // 2. 从消息的 $sender 获取权限（命令行/中间件路径）
    const sender = context?.message?.$sender as IcqqSenderInfo | undefined;
    if (!sender) {
      // 无上下文且无发送者信息 → 拒绝高权限操作
      throw new Error(
        `权限不足：无法验证身份，拒绝执行需要 ${required} 权限的操作`,
      );
    }

    let senderLevel: ToolPermissionLevel = "user";
    if (sender.isOwner || sender.role === "owner") {
      senderLevel = "group_owner";
    } else if (sender.isAdmin || sender.role === "admin") {
      senderLevel = "group_admin";
    }

    if (permissionLevels[senderLevel] < requiredLevel) {
      throw new Error(`权限不足：需要 ${required} 权限，当前为 ${senderLevel}`);
    }
  }
}
