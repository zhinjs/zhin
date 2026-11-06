import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from 'zhin.js';
import { listAllSubscriptions } from './db-store.js';
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
    key === 'pollNow' ? 'poll-now' : key === 'cleanSeen' ? 'clean-seen' : key;
  methods.get = (key: string) => origGet(normalizeKey(key));
  methods.has = (key: string) => origHas(normalizeKey(key));
  return rpc;
}
