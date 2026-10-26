import { gameCommandFeedback } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getRouletteHelp } from '../../../src/roulette-actions.js';
import { runRouletteCommand } from '../../../src/roulette-command.js';

export default defineCommand({
  description: '俄罗斯轮盘：多人轮流开枪，中弹者输', descriptionI18n: { en: "Russian roulette: take turns; the player hit loses" },
  params: { action: { type: 'string', default: '' } },
  async execute(context) {
    const action = String(context.params.action ?? '');
    const reply = await runRouletteCommand(context, context.input, action);
    return reply ?? gameCommandFeedback(context, 'unknown', action) + '\n\n' + getRouletteHelp(context);
  },
});
