import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommandText } from '../../src/adv-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Text Adventure',
  async execute({ params, input, use, owner }) {
    const action = normalizeAdvAction(String(params.action ?? ''));
    if (!action || action === 'help') return ADV_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runAdvCommandText(services, message, action);
  },
});
