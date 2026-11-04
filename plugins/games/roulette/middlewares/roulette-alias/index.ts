import { defineGameCommandAliasMiddleware, gamePlayerFromInput, replyGameOperation } from '@zhin.js/game-kit';
import { normalizeRouletteAction, getRouletteHelp } from '../../src/roulette-actions.js';
import { resolveRouletteFlow } from '../../src/runtime.js';
import { runRouletteCommand } from '../../src/roulette-command.js';

/** `轮盘 加入` / `/轮盘赌 开枪` / `roulette start` route to the same logic as the command. */
export default defineGameCommandAliasMiddleware({
  aliases: ['轮盘', '轮盘赌', 'roulette'],
  async run(action, input, context) {
    const normalized = normalizeRouletteAction(action);
    if (!normalized) return false;
    if (normalized === 'help') {
      await context.input.$reply(getRouletteHelp({ locale: context.input.locale,
        formatCommand: path => context.input.formatCommand?.(path, context.owner.id) }));
      return true;
    }
    const flow = resolveRouletteFlow(context), player = gamePlayerFromInput(input);
    await replyGameOperation({ session: flow.services.sessions, player, reply: content => context.input.$reply(content),
      run: () => runRouletteCommand(context, input, action) });
    return true;
  },
});
