import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeGuessAction,
} from '@zhin.js/game-kit';
import { GUESS_HELP, runGuessCommand } from '../src/guess-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountGuessMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountGuessMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['猜数', 'guess'],
  async run(action, input) {
    const normalized = normalizeGuessAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return GUESS_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runGuessCommand(services, message, normalized);
  },
});
