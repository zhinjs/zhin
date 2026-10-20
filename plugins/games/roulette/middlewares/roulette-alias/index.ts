import { defineGameCommandAliasMiddleware } from '@zhin.js/game-kit';
import { runRouletteCommand } from '../../src/roulette-command.js';

/** `轮盘 加入` / `/轮盘赌 开枪` / `roulette start` route to the same logic as the command. */
export default defineGameCommandAliasMiddleware({
  aliases: ['轮盘', '轮盘赌', 'roulette'],
  async run(action, input, context) {
    return runRouletteCommand(context, input, action);
  },
});
