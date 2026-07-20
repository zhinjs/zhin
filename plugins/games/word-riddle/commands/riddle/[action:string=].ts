import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommandText } from '../../src/riddle-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Word Riddle',
  async execute({ params, input, use, owner }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return RIDDLE_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runRiddleCommandText(services, message, action);
  },
});
