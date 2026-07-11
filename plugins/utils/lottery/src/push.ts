import type { Plugin } from 'zhin.js';

export async function pushTextToMasters(plugin: Plugin, text: string): Promise<void> {
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
