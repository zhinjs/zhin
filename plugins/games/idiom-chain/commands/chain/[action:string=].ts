import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeChainAction } from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommandText } from '../../src/chain-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountChainMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountChainMemoryServices();
}

export default defineCommand({
  description: 'Idiom Chain',
  async execute({ params, input }) {
    const action = normalizeChainAction(String(params.action ?? ''));
    if (!action || action === 'help') return CHAIN_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runChainCommandText(services, message, action);
  },
});
