import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runBjCommand, BJ_HELP } from './bj-command.js';
import type { SessionService } from './session-service.js';

export function registerBjHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'blackjack',
    title: '21 点',
    icon: '🃏',
    description: '经典 Blackjack，要牌或停牌挑战庄家',
    commandPrefix: '/21点',
    quickStart: '开始',
    aliases: ['bj', '21点'],
    menus: [
      { id: 'start', label: '🎮 开始新局', style: 'primary' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '21 点需要启用 database 配置。';
      if (actionId === 'help') return BJ_HELP;
      return runBjCommand(plugin, services, ctx.message, actionId === 'start' ? '开始' : actionId);
    },
  });
}
