import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeTttAction } from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommand } from '../../src/ttt-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Tic Tac Toe',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return TTT_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runTttCommand(services, message, action);
  },
});
