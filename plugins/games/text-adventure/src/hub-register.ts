import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { runAdvCommand, ADV_HELP } from './adv-command.js';
import type { GameServices } from './session-service.js';

export function registerAdvHub(getServices: () => GameServices | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'adv',
    title: '秘境探险',
    icon: '🗺️',
    description: '文字冒险，31 区域 · 15 结局 · 成就收集',
    commandPrefix: '冒险',
    quickStart: '开始',
    aliases: ['adv', '秘境'],
    menus: [
      { id: 'start', label: '🚪 开始冒险', style: 'primary' },
      { id: 'continue', label: '🔄 继续冒险' },
      { id: 'map', label: '🗺️ 探索进度' },
      { id: 'achievements', label: '🏅 成就' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '文字冒险需要启用 database 配置。';
      return runAdvCommand(ctx.plugin, services, ctx.message, actionId);
    },
  });
}

export { ADV_HELP };
