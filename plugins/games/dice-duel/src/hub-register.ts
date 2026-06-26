import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runDiceCommand, DICE_HELP } from './dice-command.js';
import type { SessionService } from './session-service.js';

export function registerDiceHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'dice',
    title: '骰子对决',
    icon: '🎲',
    description: '掷骰比大小，三局两胜',
    commandPrefix: '骰子',
    quickStart: '开始',
    aliases: ['dice'],
    menus: [
      { id: 'start', label: '🎮 开始对局', style: 'primary' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '骰子对决需要启用 database 配置。';
      return runDiceCommand(ctx.plugin, services, ctx.message, actionId);
    },
  });
}

export { DICE_HELP };
