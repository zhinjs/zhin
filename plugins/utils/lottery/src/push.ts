import type { Plugin } from 'zhin.js';

export interface LotteryPushTarget {
  readonly adapter: string;
  readonly endpointId: string;
  readonly channelType?: string;
  readonly channelId: string;
}

export type LotteryOutboundPush = (text: string) => Promise<void>;

let _outboundPush: LotteryOutboundPush | null = null;

export function setLotteryOutboundPush(push: LotteryOutboundPush | null): void {
  _outboundPush = push;
}

export function getLotteryOutboundPush(): LotteryOutboundPush | null {
  return _outboundPush;
}

/**
 * Push report text: prefer Plugin Runtime OutboundHost wiring; else legacy
 * endpoint.master via Plugin.inject.
 */
export async function pushTextToMasters(plugin: Plugin | null, text: string): Promise<void> {
  if (_outboundPush) {
    await _outboundPush(text);
    return;
  }
  if (!plugin) return;

  const root = plugin.root as {
    adapters?: string[];
    inject?: (key: string) => unknown;
  };
  const inject = root.inject?.bind(root);
  if (!inject) return;
  const adapterNames = root.adapters ?? [];
  for (const adapterName of adapterNames) {
    const adapter = inject(adapterName) as {
      endpoints?: Map<string, { $config?: { master?: unknown; name?: string }; $id?: string }>;
      sendMessage?: (opts: Record<string, unknown>) => Promise<unknown>;
    } | null;
    if (!adapter?.endpoints || !adapter.sendMessage) continue;
    for (const [, endpoint] of adapter.endpoints) {
      const master = endpoint.$config?.master;
      if (master == null || master === '') continue;
      const endpointId = endpoint.$id ?? endpoint.$config?.name ?? '';
      try {
        await adapter.sendMessage({
          context: adapterName,
          endpoint: endpointId,
          type: 'private',
          id: String(master),
          content: text,
        });
      } catch (e) {
        plugin.logger.warn(`lottery push failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
