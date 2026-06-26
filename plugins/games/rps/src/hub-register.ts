import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runRpsCommand, RPS_HELP } from './rps-command.js';
import type { SessionService } from './session-service.js';

export function registerRpsHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'rps',
    title: '猜拳对决',
    icon: '✊',
    description: '石头剪刀布，三局两胜',
    commandPrefix: '猜拳',
    quickStart: '开始',
    aliases: ['rps'],
    menus: [
      { id: 'start', label: '🎮 开始对局', style: 'primary' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '猜拳需要启用 database 配置。';
      return runRpsCommand(ctx.plugin, services, ctx.message, actionId);
    },
  });
}

export { RPS_HELP };
