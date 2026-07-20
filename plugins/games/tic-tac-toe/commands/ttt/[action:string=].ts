import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeTttAction } from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommandText } from '../../src/ttt-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Tic Tac Toe',
  async execute({ params, input, use, owner }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return TTT_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runTttCommandText(services, message, action);
  },
});
