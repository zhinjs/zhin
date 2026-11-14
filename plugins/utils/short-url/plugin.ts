import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  pluginConsoleRpcToken,
  type PluginConsoleRpcInput,
} from 'zhin.js';
import { isValidUrl, shortenUrl } from './src/short-url-lib.js';

export interface ShortUrlRecord {
  readonly id: string;
  readonly code: string;
  readonly url: string;
  readonly shortUrl: string;
  readonly createdAt: string;
  readonly [key: string]: string;
}

export interface ShortUrlConsoleStatus {
  readonly totalCount: number;
  readonly items: readonly ShortUrlRecord[];
}

export default definePlugin({
  name: 'short-url',
  metadata: {
    displayName: 'Short URL',
    displayNameI18n: { 'zh-CN': '短链接', en: 'Short URL' },
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
    // Links created from the Console in this process; is.gd itself has no listing API.
    const store = new Map<string, ShortUrlRecord>();

    const rpc = definePluginConsoleRpc({
      // Day-to-day edits belong to operators; `:write` would otherwise infer `manage` (ADR 0049).
      permissions: [{ id: 'short-url:write', level: 'operate', description: '管理短链接' }],
      status: {
        page: 'index',
        demo: true,
        requiredPermissions: ['short-url:read'],
        handler() {
          const items = [...store.values()];
          return { totalCount: items.length, items };
        },
      },
      actions: {
        create: {
          page: 'index',
          requiredPermissions: ['short-url:write'],
          async handler(input: PluginConsoleRpcInput) {
            const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
            if (!isValidUrl(rawUrl)) {
              throw new PluginConsoleRpcError('invalid_input', '请提供有效的 HTTP/HTTPS 链接');
            }
            let shortUrl: string;
            try {
              shortUrl = await shortenUrl(rawUrl);
            } catch (error) {
              throw new PluginConsoleRpcError('unavailable', `缩短失败: ${error instanceof Error ? error.message : String(error)}`);
            }
            // The code is whatever the service issued; it is never invented locally.
            const code = new URL(shortUrl).pathname.replace(/^\/+/u, '') || shortUrl;
            store.set(code, {
              id: code,
              code,
              url: rawUrl,
              shortUrl,
              createdAt: new Date().toISOString(),
            });
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
              message: deleted ? `已从列表移除 ${code}` : `未找到短链接 ${code}`,
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
