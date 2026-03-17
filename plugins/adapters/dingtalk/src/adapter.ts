/**
 * 钉钉适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  GROUP_MANAGEMENT_SKILL_KEYWORDS,
  GROUP_MANAGEMENT_SKILL_TAGS,
  type IGroupManagement,
} from "zhin.js";
import { DingTalkBot } from "./bot.js";
import type { DingTalkBotConfig } from "./types.js";

export class DingTalkAdapter extends Adapter<DingTalkBot> {
  #router: any;

  constructor(plugin: Plugin, router: any) {
    super(plugin, "dingtalk", []);
    this.#router = router;
  }

  createBot(config: DingTalkBotConfig): DingTalkBot {
    return new DingTalkBot(this, this.#router, config);
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.updateChat(sceneId, { del_useridlist: [userId] });
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.updateChat(sceneId, { name });
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChatInfo(sceneId);
  }

  async start(): Promise<void> {
    this.registerDingTalkPlatformTools();
    const groupTools = createGroupManagementTools(
      this as unknown as IGroupManagement,
      this.name
    );
    groupTools.forEach((t) => this.addTool(t));
    this.declareSkill({
      description:
        "钉钉群管理：踢人、禁言、设管理员、改群名、查成员等。仅有昵称时请先 list_members 获取 user_id 再操作。",
      keywords: GROUP_MANAGEMENT_SKILL_KEYWORDS,
      tags: GROUP_MANAGEMENT_SKILL_TAGS,
    });
    await super.start();
  }

  private registerDingTalkPlatformTools(): void {
    this.addTool({
      name: "dingtalk_get_user",
      description: "获取钉钉用户信息",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          user_id: { type: "string", description: "用户 ID" },
        },
        required: ["bot", "user_id"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return await bot.getUserInfo(user_id);
      },
    });

    this.addTool({
      name: "dingtalk_get_dept_users",
      description: "获取钉钉部门用户列表",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          dept_id: { type: "number", description: "部门 ID" },
        },
        required: ["bot", "dept_id"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, dept_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const users = await bot.getDepartmentUsers(dept_id);
        return { users, count: users.length };
      },
    });

    this.addTool({
      name: "dingtalk_list_departments",
      description: "获取钉钉部门列表",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          dept_id: { type: "number", description: "父部门 ID，默认 1（根部门）" },
        },
        required: ["bot"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, dept_id = 1 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const departments = await bot.getDepartmentList(dept_id);
        return { departments, count: departments.length };
      },
    });

    this.addTool({
      name: "dingtalk_send_work_notice",
      description: "向指定用户发送钉钉工作通知",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "用户 ID 列表",
          },
          content: { type: "string", description: "通知内容" },
        },
        required: ["bot", "user_ids", "content"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const { bot: botId, user_ids, content } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const msgContent = { msgtype: "text", text: { content } };
        const success = await bot.sendWorkNotice(user_ids, msgContent);
        return {
          success,
          message: success ? "工作通知已发送" : "发送失败",
        };
      },
    });

    this.addTool({
      name: "dingtalk_create_chat",
      description: "创建钉钉群聊",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          name: { type: "string", description: "群名" },
          owner: { type: "string", description: "群主用户 ID" },
          members: {
            type: "array",
            items: { type: "string" },
            description: "成员用户 ID 列表",
          },
        },
        required: ["bot", "name", "owner", "members"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const { bot: botId, name, owner, members } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const chatId = await bot.createChat(name, owner, members);
        return {
          success: !!chatId,
          chat_id: chatId,
          message: chatId ? `群聊创建成功: ${chatId}` : "创建失败",
        };
      },
    });

    this.addTool({
      name: "dingtalk_add_chat_members",
      description: "向钉钉群聊添加成员",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          chat_id: { type: "string", description: "群聊 ID" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "要添加的用户 ID 列表",
          },
        },
        required: ["bot", "chat_id", "user_ids"],
      },
      platforms: ["dingtalk"],
      scopes: ["group"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const { bot: botId, chat_id, user_ids } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.updateChat(chat_id, {
          add_useridlist: user_ids,
        });
        return { success, message: success ? "成员添加成功" : "添加失败" };
      },
    });

    this.addTool({
      name: "dingtalk_dept_info",
      description: "获取钉钉部门详细信息",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          dept_id: { type: "string", description: "部门 ID" },
        },
        required: ["bot", "dept_id"],
      },
      platforms: ["dingtalk"],
      scopes: ["group", "private"],
      permissionLevel: "user",
      execute: async (args) => {
        const { bot: botId, dept_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const info = await bot.getDepartmentInfo(Number(dept_id));
        return info;
      },
    });

    this.addTool({
      name: "dingtalk_update_chat",
      description: "更新钉钉群聊设置（改名、换群主、增减成员）",
      parameters: {
        type: "object",
        properties: {
          bot: { type: "string", description: "Bot 名称" },
          chat_id: { type: "string", description: "群聊 ID" },
          name: { type: "string", description: "新群名（可选）" },
          owner: { type: "string", description: "新群主 userId（可选）" },
          add_members: {
            type: "string",
            description: "要添加的成员 userId，逗号分隔（可选）",
          },
          remove_members: {
            type: "string",
            description: "要移除的成员 userId，逗号分隔（可选）",
          },
        },
        required: ["bot", "chat_id"],
      },
      platforms: ["dingtalk"],
      scopes: ["group"],
      permissionLevel: "group_admin",
      execute: async (args) => {
        const {
          bot: botId,
          chat_id,
          name,
          owner,
          add_members,
          remove_members,
        } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const options: any = {};
        if (name) options.name = name;
        if (owner) options.owner = owner;
        if (add_members)
          options.add_useridlist = add_members
            .split(",")
            .map((s: string) => s.trim());
        if (remove_members)
          options.del_useridlist = remove_members
            .split(",")
            .map((s: string) => s.trim());
        await bot.updateChat(chat_id, options);
        return { success: true, message: "群聊设置已更新" };
      },
    });

    this.plugin.logger.debug("已注册钉钉平台管理工具");
  }
}
