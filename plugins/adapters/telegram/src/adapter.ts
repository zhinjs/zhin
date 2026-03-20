/**
 * Telegram 适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
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
    this.registerTelegramPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    await super.start();
  }

  /**
   * 注册 Telegram 平台特有工具（置顶消息等）
   */
  private registerTelegramPlatformTools(): void {
    // 置顶消息工具
    this.addTool({
      name: 'telegram_pin_message',
      description: '置顶 Telegram 群组消息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID' },
        },
        required: ['bot', 'chat_id', 'message_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.pinMessage(chat_id, message_id);
        return { success, message: success ? '消息已置顶' : '操作失败' };
      },
    });

    // 取消置顶工具
    this.addTool({
      name: 'telegram_unpin_message',
      description: '取消置顶 Telegram 群组消息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID（可选，不提供则取消所有置顶）' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.unpinMessage(chat_id, message_id);
        return { success, message: success ? '已取消置顶' : '操作失败' };
      },
    });

    // 获取管理员列表工具
    this.addTool({
      name: 'telegram_list_admins',
      description: '获取 Telegram 群组管理员列表',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const admins = await bot.getChatAdmins(chat_id);
        return { 
          admins: admins.map(a => ({
            user_id: a.user.id,
            username: a.user.username,
            first_name: a.user.first_name,
            status: a.status,
          })),
          count: admins.length,
        };
      },
    });

    // 获取成员数量工具
    this.addTool({
      name: 'telegram_member_count',
      description: '获取 Telegram 群组成员数量',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const count = await bot.getChatMemberCount(chat_id);
        return { count, message: `群组共有 ${count} 名成员` };
      },
    });

    // 创建邀请链接工具
    this.addTool({
      name: 'telegram_create_invite',
      description: '创建 Telegram 群组邀请链接',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const link = await bot.createInviteLink(chat_id);
        return { invite_link: link, message: `邀请链接: ${link}` };
      },
    });

    // 发起投票
    this.addTool({
      name: 'telegram_send_poll',
      description: '在 Telegram 群组中发起投票',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          question: { type: 'string', description: '投票问题' },
          options: { type: 'string', description: '选项，用逗号分隔' },
          is_anonymous: { type: 'boolean', description: '是否匿名投票，默认 true' },
          allows_multiple: { type: 'boolean', description: '是否允许多选，默认 false' },
        },
        required: ['bot', 'chat_id', 'question', 'options'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, question, options, is_anonymous = true, allows_multiple = false } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const optList = options.split(',').map((o: string) => o.trim()).filter(Boolean);
        if (optList.length < 2) return { success: false, message: '至少需要 2 个选项' };
        const result = await bot.sendPoll(chat_id, question, optList, is_anonymous, allows_multiple);
        return { success: true, message_id: result.message_id, message: '投票已发送' };
      },
    });

    // 消息表情反应
    this.addTool({
      name: 'telegram_react',
      description: '对 Telegram 消息添加表情反应',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          message_id: { type: 'number', description: '消息 ID' },
          reaction: { type: 'string', description: '反应表情（如 👍、❤️、🔥）' },
        },
        required: ['bot', 'chat_id', 'message_id', 'reaction'],
      },
      platforms: ['telegram'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, message_id, reaction } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setMessageReaction(chat_id, message_id, reaction);
        return { success, message: success ? `已添加反应 ${reaction}` : '操作失败' };
      },
    });

    // 发送贴纸
    this.addTool({
      name: 'telegram_send_sticker',
      description: '发送 Telegram 贴纸',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          sticker: { type: 'string', description: '贴纸 file_id 或 URL' },
        },
        required: ['bot', 'chat_id', 'sticker'],
      },
      platforms: ['telegram'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, chat_id, sticker } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const result = await bot.sendStickerMessage(chat_id, sticker);
        return { success: true, message_id: result.message_id, message: '贴纸已发送' };
      },
    });

    // 设置群权限
    this.addTool({
      name: 'telegram_set_permissions',
      description: '设置 Telegram 群组的默认成员权限',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          can_send_messages: { type: 'boolean', description: '是否可以发消息' },
          can_send_photos: { type: 'boolean', description: '是否可以发图片' },
          can_send_videos: { type: 'boolean', description: '是否可以发视频' },
          can_send_polls: { type: 'boolean', description: '是否可以发投票' },
          can_send_other_messages: { type: 'boolean', description: '是否可以发贴纸/GIF等' },
          can_add_web_page_previews: { type: 'boolean', description: '是否可以添加网页预览' },
          can_change_info: { type: 'boolean', description: '是否可以改群信息' },
          can_invite_users: { type: 'boolean', description: '是否可以邀请用户' },
          can_pin_messages: { type: 'boolean', description: '是否可以置顶消息' },
        },
        required: ['bot', 'chat_id'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, ...perms } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const permissions: any = {};
        for (const [k, v] of Object.entries(perms)) {
          if (typeof v === 'boolean') permissions[k] = v;
        }
        const success = await bot.setChatPermissionsAll(chat_id, permissions);
        return { success, message: success ? '群权限已更新' : '操作失败' };
      },
    });

    // 设置群描述
    this.addTool({
      name: 'telegram_set_description',
      description: '设置 Telegram 群组描述',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          chat_id: { type: 'number', description: '聊天 ID' },
          description: { type: 'string', description: '群描述文字' },
        },
        required: ['bot', 'chat_id', 'description'],
      },
      platforms: ['telegram'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, chat_id, description } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setChatDescription(chat_id, description);
        return { success, message: success ? '群描述已更新' : '操作失败' };
      },
    });

    this.plugin.logger.debug('已注册 Telegram 平台群组管理工具');
  }
}

