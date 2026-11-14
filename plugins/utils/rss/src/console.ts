import {
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  type NormalizedPluginConsoleRpcMethod,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcInput,
  type PluginConsoleRpcJson,
} from 'zhin.js';
import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js/plugin-runtime';
import { subscriptionScope, type ChannelInfo } from './channel.js';
import { getRssSubs, listAllSubscriptions } from './db-store.js';
import { subscriptionMigrationScope } from './target-migration.js';
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

/**
 * The Console page's conversation picker submits the chosen `DeliveryTarget` (as JSON). Thread and
 * parent-channel addresses are rejected, like the chat command does.
 */
export function consoleSubscriptionTarget(raw: unknown): DeliveryTarget {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new PluginConsoleRpcError('invalid_input', '推送会话格式无效，请重新选择');
    }
  }
  let target: DeliveryTarget;
  try {
    target = createDeliveryTarget({ conversation: value as DeliveryTarget });
  } catch {
    throw new PluginConsoleRpcError('invalid_input', '推送会话格式无效，请重新选择');
  }
  if (target.parent !== undefined || target.threadId !== undefined) {
    throw new PluginConsoleRpcError('invalid_input', '暂不支持线程／父频道寻址的订阅');
  }
  return target;
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
    // Day-to-day edits belong to operators; `:write` would otherwise infer `manage` (ADR 0049).
    permissions: [{ id: 'rss:write', level: 'operate', description: '编辑订阅' }],
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
            // Rows without an exact target (older Console rows) show their stored address as text.
            conversation: sub.conversation ?? `${sub.channelType}:${sub.channelId}`,
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
          const Subs = getRssSubs(runtime.db);
          if (!Subs) {
            throw new PluginConsoleRpcError('unavailable', 'RSS 订阅表尚未初始化');
          }
          if (input.conversation !== undefined && input.conversation !== '') {
            const target = consoleSubscriptionTarget(input.conversation);
            const channel: ChannelInfo = {
              target,
              adapterName: target.endpoint.adapter,
              endpointKey: target.endpoint.id,
              channelType: target.kind,
              channelId: target.id,
              senderId: 'console',
              senderName: 'Console',
            };
            const run = async (): Promise<PluginConsoleRpcJson> => {
              const existing = await Subs.select().where({ url, ...subscriptionScope(channel) });
              if (existing.length > 0) {
                throw new PluginConsoleRpcError('conflict', '该会话已订阅此 RSS 源');
              }
              await Subs.insert({
                url,
                feed_title: title,
                ...subscriptionScope(channel),
                creator_id: 'console',
                creator_name: 'Console',
                created_at: new Date().toISOString(),
                locale: runtime.locale ?? 'zh-CN',
              });
              return {
                ok: true,
                url,
                title,
                conversation: target as unknown as PluginConsoleRpcJson,
                message: `已添加 RSS 订阅：${title} (${url})`,
              };
            };
            return runtime.migrationScopes
              ? runtime.migrationScopes.run({
                  scope: subscriptionMigrationScope({ target, adapterName: channel.adapterName,
                    endpointKey: channel.endpointKey, channelType: channel.channelType, channelId: channel.channelId }),
                  run,
                })
              : run();
          }
          // Legacy manual fields (platform + target id, no account): kept for existing callers.
          const adapter =
            typeof input.adapter === 'string' && input.adapter.trim()
              ? input.adapter.trim()
              : 'sandbox';
          const targetType = input.targetType === 'private' ? 'private' : 'group';
          const targetId =
            typeof input.targetId === 'string' && input.targetId.trim()
              ? input.targetId.trim()
              : 'console';
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
