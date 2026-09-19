import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeChainAction } from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommand } from '../../src/chain-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Idiom Chain',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const action = normalizeChainAction(String(params.action ?? ''));
    if (!action || action === 'help') return CHAIN_HELP;
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input);
    return runChainCommand(services, message, action);
  },
});
