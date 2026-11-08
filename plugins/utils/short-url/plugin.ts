import { randomUUID } from 'node:crypto';
import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  pluginConsoleRpcToken,
  type PluginConsoleRpcInput,
} from 'zhin.js';

function isValidHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ShortUrlRecord {
  readonly id: string;
  readonly code: string;
  readonly url: string;
  readonly shortUrl: string;
  readonly clicks: number;
  readonly createdAt: string;
  readonly [key: string]: string | number;
}

export interface ShortUrlConsoleStatus {
  readonly totalCount: number;
  readonly totalClicks: number;
  readonly items: readonly ShortUrlRecord[];
}

export default definePlugin({
  name: 'short-url',
  metadata: {
    displayName: 'Short URL',
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [pluginConsoleRpcToken],
    features: {
      commands: ['expand/[url]', 'shorten/[url]'],
      skills: ['short-url'],
      tools: ['skill/short-url/short_url'],
      pages: ['index'],
    },
  }),
  setup() {
    const store = new Map<string, ShortUrlRecord>();

    const rpc = definePluginConsoleRpc({
      status: {
        page: 'index',
        demo: true,
        requiredPermissions: ['short-url:read'],
        handler() {
          const items = [...store.values()];
          const totalClicks = items.reduce((sum, item) => sum + item.clicks, 0);
          return {
            totalCount: items.length,
            totalClicks,
            items,
          };
        },
      },
      actions: {
        create: {
          page: 'index',
          requiredPermissions: ['short-url:write'],
          handler(input: PluginConsoleRpcInput) {
            const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
            if (!isValidHttpUrl(rawUrl)) {
              throw new PluginConsoleRpcError('invalid_input', '请提供有效的 HTTP/HTTPS 链接');
            }
            const rawCode = typeof input.code === 'string' ? input.code.trim() : '';
            const code = rawCode || randomUUID().replace(/-/gu, '').slice(0, 6);
            const shortUrl = `https://is.gd/${code}`;
            const record: ShortUrlRecord = {
              id: code,
              code,
              url: rawUrl,
              shortUrl,
              clicks: 0,
              createdAt: new Date().toISOString(),
            };
            store.set(code, record);
            return {
              message: `短链接已创建：${shortUrl}`,
              code,
              url: rawUrl,
              shortUrl,
            };
          },
        },
        remove: {
          page: 'index',
          requiredPermissions: ['short-url:write'],
          handler(input: PluginConsoleRpcInput) {
            const code = typeof input.code === 'string' ? input.code.trim() : '';
            if (!code) {
              throw new PluginConsoleRpcError('invalid_input', '请提供要删除的短链编码');
            }
            const deleted = store.delete(code);
            return {
              ok: deleted,
              code,
              message: deleted ? `短链接 ${code} 已删除` : `未找到短链接 ${code}`,
            };
          },
        },
      },
    });

    return {
      consoleRpc: rpc,
    };
  },
});
