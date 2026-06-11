/**
 * 飞书/Lark 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { LarkAdapter } from "./adapter.js";
import {
  larkGroupPermitResolver,
  platformPermit,
  registerLarkPlatformPermitChecker,
} from "./platform-permit.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/host-router").Router;
    }
  }
  interface Adapters {
    lark: LarkAdapter;
  }
}

export * from "./types.js";
export { LarkEndpoint } from "./endpoint.js";
export { LarkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

(useContext as (key: string, fn: (router: any) => void) => void)("router", (router) => {
  provide({
    name: "lark",
    description: "Lark/Feishu Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new LarkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LarkAdapter) => {
      await adapter.stop();
    },
  } as Context<"lark">);
});

useContext('tool', 'lark', (toolService: ToolFeature, lark: LarkAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerLarkPlatformPermitChecker());
  const groupTools = createGroupManagementTools(
    lark as unknown as IGroupManagement,
    'lark',
    { permitResolver: larkGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...groupTools.map(t => toolService.addTool(t, plugin.name)));

  disposers.push(toolService.addTool({
    name: 'lark_get_user',
    description: '获取飞书用户信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        user_id: { type: 'string', description: '用户 ID (open_id)' },
      },
      required: ['endpoint_id', 'user_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      return await endpoint.getUserInfo(args.user_id);
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_create_chat',
    description: '创建飞书群聊',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        name: { type: 'string', description: '群名' },
        members: { type: 'string', description: '成员 open_id 列表，逗号分隔' },
        owner: { type: 'string', description: '群主 open_id（可选）' },
      },
      required: ['endpoint_id', 'name', 'members'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const chatId = await endpoint.createChat(args.name, args.members.split(','), args.owner);
      return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_update_chat',
    description: '更新飞书群聊信息（群名、描述）',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        name: { type: 'string', description: '新群名（可选）' },
        description: { type: 'string', description: '新描述（可选）' },
      },
      required: ['endpoint_id', 'chat_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    permissions: [platformPermit('chat_admin')],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.updateChatInfo(args.chat_id, { name: args.name, description: args.description });
      return { success, message: success ? '群信息更新成功' : '更新失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_add_members',
    description: '添加飞书群成员',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['endpoint_id', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    permissions: [platformPermit('chat_admin')],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.addChatMembers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '成员添加成功' : '添加失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_set_managers',
    description: '设置飞书群管理员',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['endpoint_id', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    permissions: [platformPermit('manage_managers')],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.setChatManagers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '管理员设置成功' : '设置失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_remove_managers',
    description: '移除飞书群管理员',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '用户 open_id 列表，逗号分隔' },
      },
      required: ['endpoint_id', 'chat_id', 'user_ids'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    permissions: [platformPermit('manage_managers')],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.removeChatManagers(args.chat_id, args.user_ids.split(','));
      return { success, message: success ? '管理员移除成功' : '移除失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_dissolve_chat',
    description: '解散飞书群聊（需要群主权限）',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
      },
      required: ['endpoint_id', 'chat_id'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.dissolveChat(args.chat_id);
      return { success, message: success ? '群聊已解散' : '解散失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'lark_upload_file',
    description: '上传文件到飞书（opus/mp4/pdf/doc/xls/ppt/stream）',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        file_path: { type: 'string', description: '本地文件路径' },
        file_type: { type: 'string', description: '文件类型', enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'] },
      },
      required: ['endpoint_id', 'file_path', 'file_type'],
    },
    platforms: ['lark'],
    tags: ['lark'],
    execute: async (args: Record<string, any>) => {
      const validTypes = ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'];
      if (!validTypes.includes(args.file_type)) {
        throw new Error(`不支持的文件类型: ${args.file_type}，支持: ${validTypes.join(', ')}`);
      }
      const endpoint = lark.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const result = await endpoint.uploadFile(args.file_path, args.file_type);
      return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});
