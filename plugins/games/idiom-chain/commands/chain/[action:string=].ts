import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeChainAction } from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommandText } from '../../src/chain-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Idiom Chain',
  async execute({ params, input, use, owner }) {
    const action = normalizeChainAction(String(params.action ?? ''));
    if (!action || action === 'help') return CHAIN_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runChainCommandText(services, message, action);
  },
});
