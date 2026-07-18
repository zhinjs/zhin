import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeChainAction,
} from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommandText } from '../src/chain-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountChainMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountChainMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['接龙', 'chain'],
  async run(action, input) {
    const normalized = normalizeChainAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return CHAIN_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runChainCommandText(services, message, normalized);
  },
});
