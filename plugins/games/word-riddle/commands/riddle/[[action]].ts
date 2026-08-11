import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommand } from '../../src/riddle-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Word Riddle',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return RIDDLE_HELP;
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input);
    return runRiddleCommand(services, message, action);
  },
});
