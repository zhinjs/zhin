/**
 * KOOK 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { KookAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    kook: KookAdapter;
  }
}

export * from "./types.js";
export { KookBot } from "./bot.js";
export { KookAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "kook",
  description: "KOOK Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: KookAdapter) => {
    await adapter.stop();
  },
});

useContext('tool', 'kook', (toolService: ToolFeature, kook: KookAdapter) => {
  const groupTools = createGroupManagementTools(
    kook as unknown as IGroupManagement,
    'kook',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, 'kook'));

  disposers.push(toolService.addTool({
    name: 'kook_grant_role',
    description: '给用户授予 KOOK 服务器角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'user_id', 'role_id'],
    },
    platforms: ['kook'],
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.grantRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已授予用户 ${args.user_id} 角色 ${args.role_id}` : '授予角色失败' };
    },
  }, 'kook'));

  disposers.push(toolService.addTool({
    name: 'kook_revoke_role',
    description: '撤销用户的 KOOK 服务器角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'user_id', 'role_id'],
    },
    platforms: ['kook'],
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.revokeRole(args.guild_id, args.user_id, args.role_id);
      return { success, message: success ? `已撤销用户 ${args.user_id} 的角色 ${args.role_id}` : '撤销角色失败' };
    },
  }, 'kook'));

  disposers.push(toolService.addTool({
    name: 'kook_list_roles',
    description: '获取 KOOK 服务器的角色列表',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
      },
      required: ['bot', 'guild_id'],
    },
    platforms: ['kook'],
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const roles = await bot.getRoleList(args.guild_id);
      return {
        roles: roles.map((r: any) => ({
          id: r.role_id,
          name: r.name,
          color: r.color,
          position: r.position,
          permissions: r.permissions,
        })),
        count: roles.length,
      };
    },
  }, 'kook'));

  disposers.push(toolService.addTool({
    name: 'kook_create_role',
    description: '在 KOOK 服务器中创建新角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        name: { type: 'string', description: '角色名称' },
      },
      required: ['bot', 'guild_id', 'name'],
    },
    platforms: ['kook'],
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const role = await bot.createRole(args.guild_id, args.name);
      return {
        success: true,
        message: `已创建角色 "${args.name}"`,
        role: { id: role.role_id, name: role.name },
      };
    },
  }, 'kook'));

  disposers.push(toolService.addTool({
    name: 'kook_delete_role',
    description: '删除 KOOK 服务器中的角色',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        guild_id: { type: 'string', description: '服务器 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['bot', 'guild_id', 'role_id'],
    },
    platforms: ['kook'],
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      const success = await bot.deleteRole(args.guild_id, args.role_id);
      return { success, message: success ? `已删除角色 ${args.role_id}` : '删除角色失败' };
    },
  }, 'kook'));

  disposers.push(toolService.addTool({
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
    tags: ['kook'],
    execute: async (args: Record<string, any>) => {
      const bot = kook.bots.get(args.bot);
      if (!bot) throw new Error(`Bot ${args.bot} 不存在`);
      switch (args.action) {
        case 'add': {
          const success = await bot.addToBlacklist(args.guild_id, args.user_id, args.remark);
          return { success, message: success ? `已将 ${args.user_id} 加入黑名单` : '操作失败' };
        }
        case 'remove': {
          const success = await bot.removeFromBlacklist(args.guild_id, args.user_id);
          return { success, message: success ? `已将 ${args.user_id} 从黑名单移除` : '操作失败' };
        }
        default:
          return { success: false, message: `未知操作: ${args.action}` };
      }
    },
  }, 'kook'));

  return () => disposers.forEach(d => d());
});
