import { Adapter, connectEndpointInstance } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

/**
 * 按配置为各 context 并行创建并连接 Endpoint。
 * 需要人为辅助登录时由「登录辅助」生产者-消费者机制处理（Web/CLI 均可消费，未消费刷新后可继续）。
 * 单个 Endpoint 连接失败时打日志，不阻塞其余 Endpoint。
 */
export async function connectEndpoints(plugin: Plugin, appConfig: AppConfig): Promise<void> {
  const contexts = new Set(appConfig.endpoints?.map((ep) => ep.context) || []);

  for (const context of contexts) {
    await plugin.useContext(context, async (adapter) => {
      if (!(adapter instanceof Adapter)) {
        throw new Error(`Adapter ${context} not found`);
      }
      const endpointsForContext = appConfig.endpoints?.filter((ep) => ep.context === context) || [];
      const results = await Promise.allSettled(
        endpointsForContext.map(async (config) => {
          const endpoint = await connectEndpointInstance({
            plugin,
            adapter,
            config: config as unknown as Record<string, unknown>,
          });
          return { endpoint, config };
        }),
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const name = (endpointsForContext[i] as { name?: string }).name ?? String(endpointsForContext[i]);
        if (r.status === 'fulfilled') {
          (adapter as Adapter).endpoints.set(r.value.endpoint.$id, r.value.endpoint);
          adapter.logger.debug(`endpoint ${r.value.endpoint.$id} of adapter ${adapter.name} connected`);
        } else {
          adapter.logger.error(`endpoint ${name} (${adapter.name}) failed to connect: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      }
    });
  }
}
