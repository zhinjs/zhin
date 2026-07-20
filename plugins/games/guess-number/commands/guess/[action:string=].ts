import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeGuessAction } from '@zhin.js/game-kit';
import { GUESS_HELP, runGuessCommand } from '../../src/guess-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Guess Number',
  async execute({ params, input, use, owner }) {
    const action = normalizeGuessAction(String(params.action ?? ''));
    if (!action || action === 'help') return GUESS_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runGuessCommand(services, message, action);
  },
});
