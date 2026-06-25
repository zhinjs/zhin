/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import path from "node:path";
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { QQAdapter } from "./adapter.js";
import { PageManager } from "@zhin.js/host-api";
import {
  platformPermit,
  qqGuildPermitResolver,
  registerQqPlatformPermitChecker,
} from "./platform-permit.js";
import { disposeQqEndpointProvision } from "./qq-endpoint-manager.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: Router;
    }
  }
}

declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

export * from "./types.js";
export { QQEndpoint } from "./endpoint.js";
export { QQAdapter } from "./adapter.js";
export { startQqBindFlow } from "./qq-bind-flow.js";
export * from "./qq-bind-api.js";
export { QqEndpointManager, disposeQqEndpointProvision } from "./qq-endpoint-manager.js";

const plugin = usePlugin();
const { provide, useContext, onDispose } = plugin;

useContext("router", (router: Router) => {
  provide({
    name: "qq",
    description: "QQ Official Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new QQAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: QQAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'qq', (toolService: ToolFeature, qq: QQAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerQqPlatformPermitChecker());
  const groupTools = createGroupManagementTools(
    qq as unknown as IGroupManagement,
    'qq',
    { permitResolver: qqGuildPermitResolver, registerChecker: false },
  );
  disposers.push(...groupTools.map(t => toolService.addTool(t, plugin.name)));

  // 获取频道列表
  disposers.push(toolService.addTool({
    name: 'qq_list_guilds',
    description: '获取 QQ 频道列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
      },
      required: ['endpoint_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const guilds = await endpoint.getGuilds();
      return { guilds, count: guilds.length };
    },
  }, plugin.name));

  // 获取子频道列表
  disposers.push(toolService.addTool({
    name: 'qq_list_channels',
    description: '获取 QQ 频道下的子频道列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['endpoint_id', 'guild_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('manage_channels')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const channels = await endpoint.getChannels(args.guild_id);
      return { channels, count: channels.length };
    },
  }, plugin.name));

  // 获取角色列表
  disposers.push(toolService.addTool({
    name: 'qq_list_roles',
    description: '获取 QQ 频道角色列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
      },
      required: ['endpoint_id', 'guild_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const roles = await endpoint.getGuildRoles(args.guild_id);
      return { roles, count: roles.length };
    },
  }, plugin.name));

  // 创建角色
  disposers.push(toolService.addTool({
    name: 'qq_create_role',
    description: '创建 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
        name: { type: 'string', description: '角色名称' },
        color: { type: 'number', description: '颜色（RGB 十进制数值）' },
      },
      required: ['endpoint_id', 'guild_id', 'name'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('guild_owner')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const role = await endpoint.createGuildRole(args.guild_id, args.name, args.color);
      return { success: !!role, role, message: role ? `角色 "${args.name}" 创建成功` : '创建失败' };
    },
  }, plugin.name));

  // 添加角色
  disposers.push(toolService.addTool({
    name: 'qq_add_role',
    description: '给成员添加 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['endpoint_id', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.addMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已给成员添加角色' : '操作失败' };
    },
  }, plugin.name));

  // 移除角色
  disposers.push(toolService.addTool({
    name: 'qq_remove_role',
    description: '移除成员的 QQ 频道角色',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
        channel_id: { type: 'string', description: '子频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
        role_id: { type: 'string', description: '角色 ID' },
      },
      required: ['endpoint_id', 'guild_id', 'channel_id', 'user_id', 'role_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('manage_roles')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.removeMemberRole(args.guild_id, args.channel_id, args.user_id, args.role_id);
      return { success, message: success ? '已移除成员的角色' : '操作失败' };
    },
  }, plugin.name));

  // 子频道详情
  disposers.push(toolService.addTool({
    name: 'qq_channel_info',
    description: '获取 QQ 频道中指定子频道的详细信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        channel_id: { type: 'string', description: '子频道 ID' },
      },
      required: ['endpoint_id', 'channel_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('guild_admin')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const info = await endpoint.getChannelInfo(args.channel_id);
      return info;
    },
  }, plugin.name));

  // 单成员详情
  disposers.push(toolService.addTool({
    name: 'qq_member_detail',
    description: '获取 QQ 频道中指定成员的详细信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        guild_id: { type: 'string', description: '频道 ID' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['endpoint_id', 'guild_id', 'user_id'],
    },
    platforms: ['qq'],
    tags: ['qq'],
    permissions: [platformPermit('guild_admin')],
    execute: async (args: Record<string, any>) => {
      const endpoint = qq.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const member = await endpoint.getGuildMember(args.guild_id, args.user_id);
      return member;
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});

// ── Web 控制台 ─────────────────────────────────────────────────────────
useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "qq",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "QQ" },
  });
});

useContext("router", "qq", (router: any, qq: QQAdapter) => {
  router.get("/api/qq/endpoints", async (ctx: any) => {
    try {
      const endpoints = Array.from(qq.endpoints.values());
      const result = await Promise.all(endpoints.map(async (endpoint) => {
        try {
          let guildCount = 0;
          try { const guilds = await endpoint.getGuilds(); guildCount = guilds?.length || 0; } catch {}
          return {
            name: endpoint.$config.name,
            connected: endpoint.$connected || false,
            guildCount,
            status: endpoint.$connected ? "online" : "offline",
          };
        } catch {
          return { name: endpoint.$config.name, connected: false, guildCount: 0, status: "error" };
        }
      }));
      ctx.body = { success: true, data: result };
    } catch {
      ctx.status = 500;
      ctx.body = { success: false, error: "获取 Endpoint 数据失败" };
    }
  });

  // Endpoint 连接/断开
  router.post("/api/qq/endpoints/:name/connect", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (endpoint.$connected) { ctx.body = { success: true, message: "已经在线" }; return; }
      await endpoint.$connect();
      ctx.body = { success: true, message: "连接成功" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "连接失败" };
    }
  });

  router.post("/api/qq/endpoints/:name/disconnect", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.body = { success: true, message: "已经离线" }; return; }
      await endpoint.$disconnect();
      ctx.body = { success: true, message: "已断开" };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "断开失败" };
    }
  });

  // 频道列表（QQ 官方 API 返回 guild_id/guild_name，归一化为控制台用的 id/name）
  router.get("/api/qq/endpoints/:name/guilds", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const raw = await endpoint.getGuilds();
      const guilds = (raw || []).map((g: any) => ({
        id: g.guild_id ?? g.id,
        name: g.guild_name ?? g.name,
        icon: g.icon,
        description: g.description,
        memberCount: g.member_count,
        ownerId: g.owner_id,
        owner: g.owner,
        joinTime: g.join_time,
      }));
      ctx.body = { success: true, data: guilds };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取频道失败" };
    }
  });

  // 子频道列表（QQ 官方 API 返回 channel_id/channel_name，归一化为 id/name）
  router.get("/api/qq/endpoints/:name/guilds/:guildId/channels", async (ctx: any) => {
    try {
      const endpoint = qq.endpoints.get(ctx.params.name);
      if (!endpoint) { ctx.status = 404; ctx.body = { success: false, error: "Endpoint 不存在" }; return; }
      if (!endpoint.$connected) { ctx.status = 400; ctx.body = { success: false, error: "Endpoint 未连接" }; return; }
      const raw = await endpoint.getChannels(ctx.params.guildId);
      const channels = (raw || []).map((ch: any) => ({
        id: ch.channel_id ?? ch.id,
        name: ch.channel_name ?? ch.name,
        type: ch.type,
        subType: ch.sub_type,
        position: ch.position,
        parentId: ch.parent_id,
      }));
      ctx.body = { success: true, data: channels };
    } catch (e: unknown) {
      ctx.status = 500;
      ctx.body = { success: false, error: e instanceof Error ? e.message : "获取子频道失败" };
    }
  });
});

onDispose(() => {
  disposeQqEndpointProvision();
});
