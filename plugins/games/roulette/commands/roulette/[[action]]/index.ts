import { defineCommand } from 'zhin.js/command';
import { ROULETTE_HELP } from '../../../src/roulette-actions.js';
import { runRouletteCommand } from '../../../src/roulette-command.js';

export default defineCommand({
  description: '俄罗斯轮盘：多人轮流开枪，中弹者输',
  params: { action: { type: 'string', default: '' } },
  async execute(context) {
    const action = String(context.params.action ?? '');
    const reply = await runRouletteCommand(context, context.input, action);
    return reply ?? `未知操作：${action}\n\n${ROULETTE_HELP}`;
  },
});
