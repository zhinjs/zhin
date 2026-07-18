import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeDiceAction,
} from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommandText } from '../src/dice-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountDiceMemoryServices } from '../src/memory-db.js';
import type { SessionService } from '../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountDiceMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['骰子', 'dice'],
  async run(action, input) {
    const normalized = normalizeDiceAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return DICE_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runDiceCommandText(services, message, normalized);
  },
});
