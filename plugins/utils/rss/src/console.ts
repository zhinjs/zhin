import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from 'zhin.js';
import { getRssSubs, listAllSubscriptions } from './db-store.js';
import { cleanOldSeen, pollAllFeeds } from './poll.js';
import { rssRuntimeToken, type RssRuntime } from './runtime.js';

type RssRuntimeLookup = {
  readonly use?: (token: typeof rssRuntimeToken) => RssRuntime | undefined;
};

function sanitizeFeedUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function resolveRssRuntime(call: PluginConsoleRpcCall, fallback?: RssRuntime): RssRuntime {
  const runtime = (call.runtime as RssRuntimeLookup | undefined)?.use?.(rssRuntimeToken) ?? fallback;
  if (!runtime) {
    throw new PluginConsoleRpcError('unavailable', 'RSS runtime is not initialized');
  }
  return runtime;
}

export function createRssConsoleRpc(defaultRuntime?: RssRuntime): PluginConsoleRpc {
  const rpc = definePluginConsoleRpc({
    status: {
      page: 'index',
      requiredPermissions: ['rss:read'],
      async handler(_input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
        const runtime = resolveRssRuntime(call, defaultRuntime);
        const allSubscriptions = await listAllSubscriptions(runtime.db);
        return {
          subscriptionCount: allSubscriptions.length,
          pollCron: runtime.config.pollCron,
          maxItemsPerPoll: runtime.config.maxItemsPerPoll ?? runtime.config.maxItems,
          fetchTimeoutMs: runtime.config.fetchTimeoutMs ?? runtime.config.timeout,
          subscriptions: allSubscriptions.slice(0, 100).map((sub) => ({
            ...sub,
            url: sanitizeFeedUrl(sub.url),
          })),
        } as unknown as PluginConsoleRpcJson;
      },
    },
    actions: {
      'add-subscription': {
        page: 'index',
        requiredPermissions: ['rss:write'],
        async handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
          const runtime = resolveRssRuntime(call, defaultRuntime);
          const url = typeof input.url === 'string' ? input.url.trim() : '';
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
              throw new Error('invalid protocol');
            }
          } catch {
            throw new PluginConsoleRpcError('invalid_input', '请提供有效的 HTTP/HTTPS RSS 订阅源 URL');
          }
          const title =
            typeof input.title === 'string' && input.title.trim()
              ? input.title.trim()
              : parsedUrl.hostname;
          const adapter =
            typeof input.adapter === 'string' && input.adapter.trim()
              ? input.adapter.trim()
              : 'sandbox';
          const targetType = input.targetType === 'private' ? 'private' : 'group';
          const targetId =
            typeof input.targetId === 'string' && input.targetId.trim()
              ? input.targetId.trim()
              : 'console';
          const Subs = getRssSubs(runtime.db);
          if (!Subs) {
            throw new PluginConsoleRpcError('unavailable', 'RSS 订阅表尚未初始化');
          }
          await Subs.insert({
            url,
            feed_title: title,
            adapter_name: adapter,
            endpoint_id: adapter,
            channel_type: targetType,
            channel_id: targetId,
            creator_id: 'console',
            creator_name: 'Console',
            created_at: new Date().toISOString(),
          });
          return {
            ok: true,
            url,
            title,
            adapter,
            targetType,
            targetId,
            message: `已添加 RSS 订阅：${title} (${url})`,
          };
        },
      },
      'remove-subscription': {
        page: 'index',
        requiredPermissions: ['rss:write'],
        async handler(input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
          const runtime = resolveRssRuntime(call, defaultRuntime);
          const url = typeof input.url === 'string' ? input.url.trim() : '';
          const id = typeof input.id === 'string' ? input.id.trim() : '';
          if (!url && !id) {
            throw new PluginConsoleRpcError('invalid_input', '请提供要移除的 RSS 订阅 URL 或 ID');
          }
          const Subs = getRssSubs(runtime.db);
          if (!Subs) {
            throw new PluginConsoleRpcError('unavailable', 'RSS 订阅表尚未初始化');
          }
          if (url) {
            await Subs.delete().where({ url });
          } else {
            await Subs.delete().where({ id });
          }
          return {
            ok: true,
            url: url || id,
            message: `已移除 RSS 订阅：${url || id}`,
          };
        },
      },
      'poll-now': {
        page: 'index',
        requiredPermissions: ['rss:write'],
        async handler(_input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
          const runtime = resolveRssRuntime(call, defaultRuntime);
          await pollAllFeeds(runtime);
          return { ok: true, polledAt: Date.now() };
        },
      },
      'clean-seen': {
        page: 'index',
        requiredPermissions: ['rss:write'],
        async handler(_input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): Promise<PluginConsoleRpcJson> {
          const runtime = resolveRssRuntime(call, defaultRuntime);
          await cleanOldSeen(runtime);
          return { ok: true, cleanedAt: Date.now() };
        },
      },
    },
  });

  const methods = rpc.methods as Map<string, NormalizedPluginConsoleRpcMethod>;
  const origGet = methods.get.bind(methods);
  const origHas = methods.has.bind(methods);
  const normalizeKey = (key: string) =>
    key === 'pollNow'
      ? 'poll-now'
      : key === 'cleanSeen'
        ? 'clean-seen'
        : key === 'addSubscription'
          ? 'add-subscription'
          : key === 'removeSubscription'
            ? 'remove-subscription'
            : key;
  methods.get = (key: string) => origGet(normalizeKey(key));
  methods.has = (key: string) => origHas(normalizeKey(key));
  return rpc;
}
