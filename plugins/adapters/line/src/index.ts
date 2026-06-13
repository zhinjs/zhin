/**
 * LINE Messaging API 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from 'zhin.js';
import { LineAdapter } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Adapters {
    line: LineAdapter;
  }
}

export * from './types.js';
export { LineEndpoint } from './endpoint.js';
export { LineAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext('router', (router: any) => {
  provide({
    name: 'line',
    description: 'LINE Messaging API Endpoint Adapter',
    mounted: async (p: Plugin) => {
      const adapter = new LineAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LineAdapter) => {
      await adapter.stop();
    },
  });
});

// L11: Register LINE-specific tools
useContext('tool', 'line', (toolService: any, lineAdapter: LineAdapter) => {
  const accessToken = lineAdapter.endpoints.values().next().value?.$config?.channelAccessToken;
  const apiBaseUrl = lineAdapter.endpoints.values().next().value?.$config?.apiBaseUrl || 'https://api.line.me';

  const disposers: (() => void)[] = [];

  disposers.push(toolService.addTool({
    name: 'line_get_profile',
    description: 'Get LINE user profile by userId',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'LINE user ID (starts with U)' },
      },
      required: ['userId'],
    },
    execute: async ({ userId }: { userId: string }) => {
      if (!userId.startsWith('U')) {
        throw new Error(`Invalid userId "${userId}": must start with U`);
      }
      const response = await fetch(`${apiBaseUrl}/v2/profile/${userId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LINE Profile API error ${response.status}: ${errorText}`);
      }
      return await response.json();
    },
  }));

  disposers.push(toolService.addTool({
    name: 'line_get_group_members',
    description: 'Get LINE group member IDs',
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'LINE group ID (starts with G)' },
      },
      required: ['groupId'],
    },
    execute: async ({ groupId }: { groupId: string }) => {
      if (!groupId.startsWith('G')) {
        throw new Error(`Invalid groupId "${groupId}": must start with G`);
      }
      const response = await fetch(`${apiBaseUrl}/v2/bot/group/${groupId}/members/ids`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LINE Group Members API error ${response.status}: ${errorText}`);
      }
      return await response.json();
    },
  }));

  return () => {
    for (const disposer of disposers) disposer();
  };
});
