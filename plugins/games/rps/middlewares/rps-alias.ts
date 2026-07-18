import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeRpsAction,
} from '@zhin.js/game-kit';
import { RPS_HELP, runRpsCommandText } from '../src/rps-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountRpsMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountRpsMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['猜拳', 'rps'],
  async run(action, input) {
    const normalized = normalizeRpsAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return RPS_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runRpsCommandText(services, message, normalized);
  },
});
