import { defineCommand } from 'zhin.js/command';
import { gameFeatureId, type GameIndex } from '@zhin.js/game-kit';

export default defineCommand({
  description: 'Game hub — list loaded games',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, project }) {
    const games = project<GameIndex>(gameFeatureId);
    const action = String(params.action ?? '').trim();
    if (action) {
      const game = games.get(action);
      if (game) {
        const start = game.quickStart ? ` ${game.quickStart}` : '';
        return `发送 \`${game.commandPrefix}${start}\` 开始 ${game.title}`;
      }
    }
    return games.formatHelp();
  },
});
