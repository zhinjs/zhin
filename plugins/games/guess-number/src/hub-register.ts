import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runGuessCommand, GUESS_HELP } from './guess-command.js';
import type { SessionService } from './session-service.js';

export function registerGuessHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'guess',
    title: '猜数字',
    icon: '🔢',
    description: '1~100 七步猜中神秘数',
    commandPrefix: '猜数',
    quickStart: '开始',
    aliases: ['guess'],
    menus: [
      { id: 'start', label: '🎮 开始新局', style: 'primary' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '猜数字需要启用 database 配置。';
      return runGuessCommand(services, ctx.message, actionId);
    },
  });
}

export { GUESS_HELP };
