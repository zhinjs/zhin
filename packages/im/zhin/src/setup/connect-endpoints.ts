import { Adapter, connectEndpointInstance, type Plugin } from '@zhin.js/core';

import { formatCompactLog } from '@zhin.js/logger';
import type { AppConfig } from '../types.js';

const CONNECT_RETRY_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endpointDisplayName(config: Record<string, unknown>): string {
  return String(config.name ?? config.context ?? 'unknown');
}

/** 检测 zhin.config endpoints[].name 是否仍为未展开的 ${ENV} 占位符。 */
export function validateEndpointConfigName(config: Record<string, unknown>): string | null {
  const name = String(config.name ?? '').trim();
  if (!name) return 'endpoint name 为空';
  if (/^\$\{[^}]+\}$/.test(name)) return `环境变量未解析: ${name}`;
  return null;
}

async function connectOneWithRetry(
  plugin: Plugin,
  adapter: Adapter,
  config: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof connectEndpointInstance>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONNECT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await connectEndpointInstance({
        plugin,
        adapter,
        config,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= CONNECT_RETRY_ATTEMPTS) break;
      await sleep(CONNECT_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 按配置为各 context 顺序创建并连接 Endpoint（icqq 等多账号 IPC 并行易失败，故不用 Promise.all）。
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
      const seen = new Set<string>();
      let connected = 0;
      let failed = 0;
      let skipped = 0;

      for (const rawConfig of endpointsForContext) {
        const config = rawConfig as unknown as Record<string, unknown>;
        const name = endpointDisplayName(config);
        const invalid = validateEndpointConfigName(config);
        if (invalid) {
          skipped++;
          adapter.logger.error(formatCompactLog('Endpoint', {
            adapter: adapter.name,
            name,
            skip: invalid,
          }));
          continue;
        }
        if (seen.has(name)) {
          skipped++;
          adapter.logger.error(formatCompactLog('Endpoint', {
            adapter: adapter.name,
            name,
            skip: 'duplicate_name',
          }));
          continue;
        }
        seen.add(name);

        try {
          const endpoint = await connectOneWithRetry(plugin, adapter, config);
          adapter.endpoints.set(endpoint.$id, endpoint as never);
          connected++;
          adapter.logger.debug(formatCompactLog('Endpoint', {
            adapter: adapter.name,
            connected: endpoint.$id,
          }));
        } catch (error) {
          failed++;
          adapter.logger.error(formatCompactLog('Endpoint', {
            adapter: adapter.name,
            name,
            failed: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      adapter.logger.debug(formatCompactLog('Endpoint', {
        adapter: adapter.name,
        connected,
        failed,
        skipped,
        total: endpointsForContext.length,
      }));
    });
  }
}
