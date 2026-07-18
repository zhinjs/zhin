import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeRiddleAction,
} from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommandText } from '../src/riddle-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountRiddleMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountRiddleMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['猜谜', 'riddle'],
  async run(action, input) {
    const normalized = normalizeRiddleAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return RIDDLE_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runRiddleCommandText(services, message, normalized);
  },
});
