import { defineCommand } from '@zhin.js/command';
import { formatRuntimeGamesHelp, getRuntimeGame } from '@zhin.js/game-kit';

export default defineCommand({
  description: 'Game hub — list loaded games',
  async execute({ params }) {
    const action = String(params.action ?? '').trim();
    if (action) {
      const game = getRuntimeGame(action);
      if (game) {
        const start = game.quickStart ? ` ${game.quickStart}` : '';
        return `发送 \`${game.commandPrefix}${start}\` 开始 ${game.title}`;
      }
    }
    return formatRuntimeGamesHelp();
  },
});
