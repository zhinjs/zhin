import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { idiomCount } from './engine.js';
import { runChainCommand, CHAIN_HELP } from './chain-command.js';
import type { SessionService } from './session-service.js';

export function registerChainHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'chain',
    title: '成语接龙',
    icon: '📜',
    description: `四字成语接龙（同音/同字），词库 ${idiomCount()} 条`,
    commandPrefix: '/接龙',
    quickStart: 'start_pinyin',
    aliases: ['chain'],
    menus: [
      { id: 'start_pinyin', label: '🎮 同音接龙', style: 'primary' },
      { id: 'start_char', label: '📝 同字接龙' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '成语接龙需要启用 database 配置。';
      return runChainCommand(ctx.plugin, services, ctx.message, actionId);
    },
  });
}

export { CHAIN_HELP };
