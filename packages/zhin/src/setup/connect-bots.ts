import { Adapter } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

/**
 * 按配置为各 context 创建并连接 bot
 */
export async function connectBots(plugin: Plugin, appConfig: AppConfig): Promise<void> {
  const contexts = new Set(appConfig.bots?.map((bot) => bot.context) || []);

  for (const context of contexts) {
    await plugin.useContext(context, async (adapter) => {
      if (!(adapter instanceof Adapter)) {
        throw new Error(`Adapter ${context} not found`);
      }
      const botsForContext = appConfig.bots?.filter((bot) => bot.context === context) || [];
      for (const config of botsForContext) {
        const bot = adapter.createBot(config);
        await bot.$connect();
        adapter.bots.set(bot.$id, bot);
        adapter.logger.debug(`bot ${bot.$id} of adapter ${adapter.name} connected`);
      }
    });
  }
}
