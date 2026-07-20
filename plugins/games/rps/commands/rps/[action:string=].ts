import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { RPS_HELP, runRpsCommandText } from '../../src/rps-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'RPS',
  async execute({ params, input, use, owner }) {
    const action = normalizeRpsAction(String(params.action ?? ''));
    if (!action || action === 'help') return RPS_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runRpsCommandText(services, message, action);
  },
});
