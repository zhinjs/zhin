import { getPlugin } from 'zhin.js';
import { ensureGameHubService } from '@zhin.js/game-shared';
import { riddleCount } from './riddles-catalog.js';
import { runRiddleCommand, RIDDLE_HELP } from './riddle-command.js';
import type { SessionService } from './session-service.js';

const counts = riddleCount();

export function registerRiddleHub(getServices: () => SessionService | null): () => void {
  const plugin = getPlugin();
  ensureGameHubService(plugin);
  return plugin.registerGame({
    id: 'riddle',
    title: '猜谜',
    icon: '🧩',
    description: `字谜 ${counts.char.toLocaleString('zh-CN')} 题 + 成语 ${counts.idiom.toLocaleString('zh-CN')} 题`,
    commandPrefix: '/猜谜',
    quickStart: '开始',
    aliases: ['riddle'],
    menus: [
      { id: 'char', label: '🔤 字谜模式', style: 'primary' },
      { id: 'idiom', label: '📜 成语模式' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
    runAction: async (actionId, ctx) => {
      const services = getServices();
      if (!services) return '猜谜需要启用 database 配置。';
      return runRiddleCommand(ctx.plugin, services, ctx.message, actionId === 'start' ? 'char' : actionId);
    },
  });
}

export { RIDDLE_HELP };
