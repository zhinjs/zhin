import { gameCommandFeedback, gamePlayerFromInput, replyGameOperation } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { resolveRouletteFlow } from '../../../src/runtime.js';
import { getRouletteHelp, normalizeRouletteAction } from '../../../src/roulette-actions.js';
import { runRouletteCommand } from '../../../src/roulette-command.js';

export default defineCommand({
  description: '俄罗斯轮盘：多人轮流开枪，中弹者输', descriptionI18n: { en: "Russian roulette: take turns; the player hit loses" },
  params: { action: { type: 'string', default: '' } },
  async execute(context) {
    const action = String(context.params.action ?? '');
    const normalized = normalizeRouletteAction(action);
    if (normalized === 'help') return getRouletteHelp(context);
    if (!normalized) return gameCommandFeedback(context, 'unknown', action) + '\n\n' + getRouletteHelp(context);
    const flow = resolveRouletteFlow(context), player = gamePlayerFromInput(context.input, context);
    await replyGameOperation({ session: flow.services.sessions, player, reply: context.session?.reply,
      run: () => runRouletteCommand(context, context.input, action) });
  },
});
