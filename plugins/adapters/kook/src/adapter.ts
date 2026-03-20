/**
 * KOOK 适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
  type ToolPermissionLevel,
} from "zhin.js";
import { KookBot } from "./bot.js";
import type { KookBotConfig } from "./types.js";
import { KookPermission, type KookSenderInfo } from "./types.js";

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
    this.registerKookPlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    await super.start();
    this.plugin.logger.info("KOOK 适配器已启动");
  }

  async stop(): Promise<void> {
    await super.stop();
    this.plugin.logger.info("KOOK 适配器已停止");
  }

  /**
   * 注册 KOOK 平台特有工具（角色授予等）
   */
  private registerKookPlatformTools(): void {
    // 角色管理工具 - 授予角色
    this.addTool({
      name: 'kook_grant_role',
      description: '给用户授予 KOOK 服务器角色',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '用户 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.grantRole(guild_id, user_id, role_id);
        return { success, message: success ? `已授予用户 ${user_id} 角色 ${role_id}` : '授予角色失败' };
      },
    });

    // 角色管理工具 - 撤销角色
    this.addTool({
      name: 'kook_revoke_role',
      description: '撤销用户的 KOOK 服务器角色',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '用户 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.revokeRole(guild_id, user_id, role_id);
        return { success, message: success ? `已撤销用户 ${user_id} 的角色 ${role_id}` : '撤销角色失败' };
      },
    });

    // 获取角色列表工具
    this.addTool({
      name: 'kook_list_roles',
      description: '获取 KOOK 服务器的角色列表',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
        },
        required: ['bot', 'guild_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'user', // 普通用户可查看
      execute: async (args) => {
        const { bot: botId, guild_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const roles = await bot.getRoleList(guild_id);
        return { 
          roles: roles.map(r => ({
            id: r.role_id,
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions,
          })),
          count: roles.length,
        };
      },
    });

    // 创建角色工具
    this.addTool({
      name: 'kook_create_role',
      description: '在 KOOK 服务器中创建新角色（需要服务器主人权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          name: {
            type: 'string',
            description: '角色名称',
          },
        },
        required: ['bot', 'guild_id', 'name'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, guild_id, name } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const role = await bot.createRole(guild_id, name);
        return { 
          success: true, 
          message: `已创建角色 "${name}"`,
          role: {
            id: role.role_id,
            name: role.name,
          },
        };
      },
    });

    // 删除角色工具
    this.addTool({
      name: 'kook_delete_role',
      description: '删除 KOOK 服务器中的角色（需要服务器主人权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, guild_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const success = await bot.deleteRole(guild_id, role_id);
        return { success, message: success ? `已删除角色 ${role_id}` : '删除角色失败' };
      },
    });

    // 黑名单管理（仅支持 add/remove，通过 GuildMember API）
    this.addTool({
      name: 'kook_blacklist',
      description: 'KOOK 服务器黑名单管理：添加/移除',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          guild_id: { type: 'string', description: '服务器 ID' },
          action: { type: 'string', description: 'add|remove', enum: ['add', 'remove'] },
          user_id: { type: 'string', description: '用户 ID' },
          remark: { type: 'string', description: '备注（add 可选）' },
        },
        required: ['bot', 'guild_id', 'action', 'user_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, action, user_id, remark } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        this.checkPermission(context, 'group_admin');

        switch (action) {
          case 'add': {
            const success = await bot.addToBlacklist(guild_id, user_id, remark);
            return { success, message: success ? `已将 ${user_id} 加入黑名单` : '操作失败' };
          }
          case 'remove': {
            const success = await bot.removeFromBlacklist(guild_id, user_id);
            return { success, message: success ? `已将 ${user_id} 从黑名单移除` : '操作失败' };
          }
          default: return { success: false, message: `未知操作: ${action}` };
        }
      },
    });

    this.plugin.logger.debug('已注册 KOOK 平台管理工具');
  }

  /**
   * 检查执行上下文中的权限
   */
  private checkPermission(context: any, required: ToolPermissionLevel): void {
    if (!context?.message) return; // 无上下文时跳过检查（命令行调用）
    
    const sender = context.message.$sender as KookSenderInfo;
    if (!sender) return;
    
    const permissionLevels: Record<ToolPermissionLevel, number> = {
      'user': 0,
      'group_admin': 1,
      'group_owner': 2,
      'bot_admin': 3,
      'owner': 4,
    };
    
    // 获取发送者的实际权限级别
    let senderLevel: ToolPermissionLevel = 'user';
    
    if (sender.isGuildOwner || sender.permission === KookPermission.Owner) {
      senderLevel = 'group_owner';
    } else if (sender.isAdmin || sender.permission === KookPermission.Admin || 
               sender.permission === KookPermission.ChannelAdmin) {
      senderLevel = 'group_admin';
    }
    
    // TODO: 检查是否为 bot_admin 或 owner（需要从 zhin 配置中获取）
    
    if (permissionLevels[senderLevel] < permissionLevels[required]) {
      throw new Error(`权限不足：需要 ${required} 权限，当前为 ${senderLevel}`);
    }
  }
}

