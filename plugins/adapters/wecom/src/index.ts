/**
 * 企业微信适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type ToolFeature } from 'zhin.js';
import { WecomAdapter } from './adapter.js';
import {
  registerWecomPlatformPermitChecker,
  platformPermit,
} from './platform-permit.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    wecom: WecomAdapter;
  }
}

export * from './types.js';
export { WecomEndpoint } from './endpoint.js';
export { WecomAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext('router', (router: any) => {
  provide({
    name: 'wecom',
    description: 'WeCom (企业微信) Endpoint Adapter',
    mounted: async (p: Plugin) => {
      const adapter = new WecomAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: WecomAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'wecom', (toolService: ToolFeature, wecom: WecomAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerWecomPlatformPermitChecker());

  disposers.push(toolService.addTool({
    name: 'wecom_get_user',
    description: '获取企业微信用户信息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['endpoint_id', 'user_id'],
    },
    platforms: ['wecom'],
    tags: ['wecom'],
    execute: async (args: Record<string, any>) => {
      const endpoint = wecom.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      return await endpoint.getUserInfo(args.user_id);
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'wecom_get_dept_users',
    description: '获取企业微信部门用户列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        dept_id: { type: 'string', description: '部门 ID' },
      },
      required: ['endpoint_id', 'dept_id'],
    },
    platforms: ['wecom'],
    tags: ['wecom'],
    execute: async (args: Record<string, any>) => {
      const endpoint = wecom.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const users = await endpoint.getDepartmentUsers(Number(args.dept_id));
      return { users, count: users.length };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'wecom_list_departments',
    description: '获取企业微信部门列表',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        dept_id: { type: 'string', description: '父部门 ID，默认 1（跟部门）' },
      },
      required: ['endpoint_id'],
    },
    platforms: ['wecom'],
    tags: ['wecom'],
    execute: async (args: Record<string, any>) => {
      const endpoint = wecom.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const departments = await endpoint.getDepartmentList(Number(args.dept_id) || 1);
      return { departments, count: departments.length };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'wecom_send_text',
    description: '向指定企业微信用户发送文本消息',
    parameters: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint 名称', contextKey: 'endpointId' },
        user_id: { type: 'string', description: '用户 ID' },
        content: { type: 'string', description: '消息内容' },
      },
      required: ['endpoint_id', 'user_id', 'content'],
    },
    platforms: ['wecom'],
    tags: ['wecom'],
    execute: async (args: Record<string, any>) => {
      const endpoint = wecom.endpoints.get(args.endpoint_id);
      if (!endpoint) throw new Error(`Endpoint ${args.endpoint_id} 不存在`);
      const success = await endpoint.sendTextMessage(args.user_id, args.content);
      return { success, message: success ? '消息已发送' : '发送失败' };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});
