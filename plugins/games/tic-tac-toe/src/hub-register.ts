import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runTttCommand, TTT_HELP } from './ttt-command.js';
import type { SessionServices } from './session-service.js';

export function registerTttHub(getServices: () => SessionServices | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'ttt',
    title: '井字棋',
    icon: '♟️',
    description: '三子连珠，群聊排队或人机对战',
    commandPrefix: '/井字棋',
    quickStart: '人机',
    aliases: ['ttt'],
    menus: [
      { id: 'bot', label: '🤖 人机对战', style: 'primary' },
      { id: 'join', label: '👥 加入排队', groupOnly: true },
      { id: 'spectate', label: '👀 观战', groupOnly: true },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '井字棋需要启用 database 配置。';
      return runTttCommand(ctx.plugin, services, ctx.message, actionId);
    },
  });
}

export { TTT_HELP };
