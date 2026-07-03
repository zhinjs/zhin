/**
 * 钉钉适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import { DingTalkAdapter } from "./adapter.js";
import {
  dingtalkGroupPermitResolver,
  platformPermit,
  registerDingtalkPlatformPermitChecker,
} from "./platform-permit.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/host-router").Router;
    }
  }
  interface Adapters {
    dingtalk: DingTalkAdapter;
  }
}

export * from "./types.js";
export { DingTalkEndpoint } from "./endpoint.js";
export { DingTalkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext("router", (router: any) => {
  provide({
    name: "dingtalk",
    description: "DingTalk Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new DingTalkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: DingTalkAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'dingtalk', (toolService: ToolFeature, dingtalk: DingTalkAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerDingtalkPlatformPermitChecker());
  const sceneTools = createSceneManagementTools(
    dingtalk as unknown as ISceneManagement,
    'dingtalk',
    { permitResolver: dingtalkGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));

  disposers.push(toolService.addTool({
    name: 'dingtalk_get_user',
    description: '获取钉钉用户信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['endpoint_id', 'user_id'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      return await endpoint.getUserInfo(args.user_id);
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_get_dept_users',
    description: '获取钉钉部门用户列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        dept_id: { type: 'string', description: '部门 ID' },
      },
      required: ['endpoint_id', 'dept_id'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const users = await endpoint.getDepartmentUsers(args.dept_id);
      return { users, count: users.length };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_list_departments',
    description: '获取钉钉部门列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        dept_id: { type: 'string', description: '父部门 ID，默认 1（根部门）' },
      },
      required: ['endpoint_id'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const departments = await endpoint.getDepartmentList(args.dept_id || '1');
      return { departments, count: departments.length };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_send_work_notice',
    description: '向指定用户发送钉钉工作通知',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        user_ids: { type: 'string', description: '用户 ID 列表，逗号分隔' },
        content: { type: 'string', description: '通知内容' },
      },
      required: ['endpoint_id', 'user_ids', 'content'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const msgContent = { msgtype: 'text', text: { content: args.content } };
      const success = await endpoint.sendWorkNotice(args.user_ids.split(','), msgContent);
      return { success, message: success ? '工作通知已发送' : '发送失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_create_chat',
    description: '创建钉钉群聊',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        name: { type: 'string', description: '群名' },
        owner: { type: 'string', description: '群主用户 ID' },
        members: { type: 'string', description: '成员用户 ID 列表，逗号分隔' },
      },
      required: ['endpoint_id', 'name', 'owner', 'members'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    permissions: [platformPermit('chat_owner')],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const chatId = await endpoint.createChat(args.name, args.owner, args.members.split(','));
      return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_add_chat_members',
    description: '向钉钉群聊添加成员',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        user_ids: { type: 'string', description: '要添加的用户 ID 列表，逗号分隔' },
      },
      required: ['endpoint_id', 'chat_id', 'user_ids'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    permissions: [platformPermit('chat_admin')],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.updateChat(args.chat_id, { add_useridlist: args.user_ids.split(',') });
      return { success, message: success ? '成员添加成功' : '添加失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_dept_info',
    description: '获取钉钉部门详细信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        dept_id: { type: 'string', description: '部门 ID' },
      },
      required: ['endpoint_id', 'dept_id'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      return await endpoint.getDepartmentInfo(Number(args.dept_id));
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'dingtalk_update_chat',
    description: '更新钉钉群聊设置（改名、换群主、增减成员）',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        chat_id: { type: 'string', description: '群聊 ID' },
        name: { type: 'string', description: '新群名（可选）' },
        owner: { type: 'string', description: '新群主 userId（可选）' },
        add_members: { type: 'string', description: '要添加的成员 userId，逗号分隔（可选）' },
        remove_members: { type: 'string', description: '要移除的成员 userId，逗号分隔（可选）' },
      },
      required: ['endpoint_id', 'chat_id'],
    },
    platforms: ['dingtalk'],
    tags: ['dingtalk'],
    execute: async (args: Record<string, any>) => {
      const endpoint = dingtalk.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const options: any = {};
      if (args.name) options.name = args.name;
      if (args.owner) options.owner = args.owner;
      if (args.add_members) options.add_useridlist = args.add_members.split(',').map((s: string) => s.trim());
      if (args.remove_members) options.del_useridlist = args.remove_members.split(',').map((s: string) => s.trim());
      await endpoint.updateChat(args.chat_id, options);
      return { success: true, message: '群聊设置已更新' };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});
