import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommand } from '../../src/adv-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Text Adventure',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const action = normalizeAdvAction(String(params.action ?? ''));
    if (!action || action === 'help') return ADV_HELP;
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input);
    return runAdvCommand(services, message, action);
  },
});
