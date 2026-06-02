import { Adapter } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

/**
 * 按配置为各 context 并行创建并连接 bot。
 * 需要人为辅助登录时由「登录辅助」生产者-消费者机制处理（Web/CLI 均可消费，未消费刷新后可继续）。
 * 单个 bot 连接失败时打日志，不阻塞其余 bot。
 */
export async function connectBots(plugin: Plugin, appConfig: AppConfig): Promise<void> {
  const contexts = new Set(appConfig.bots?.map((bot) => bot.context) || []);

  for (const context of contexts) {
    await plugin.useContext(context, async (adapter) => {
      if (!(adapter instanceof Adapter)) {
        throw new Error(`Adapter ${context} not found`);
      }
      const botsForContext = appConfig.bots?.filter((bot) => bot.context === context) || [];
      const results = await Promise.allSettled(
        botsForContext.map(async (config) => {
          const bot = adapter.createBot(config);
          await bot.$connect();
          return { bot, config };
        }),
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const name = (botsForContext[i] as { name?: string }).name ?? String(botsForContext[i]);
        if (r.status === 'fulfilled') {
          adapter.bots.set(r.value.bot.$id, r.value.bot);
          adapter.logger.debug(`bot ${r.value.bot.$id} of adapter ${adapter.name} connected`);
        } else {
          adapter.logger.error(`bot ${name} (${adapter.name}) failed to connect: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      }
    });
  }
}
