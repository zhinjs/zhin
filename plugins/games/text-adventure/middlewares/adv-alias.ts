import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeAdvAction,
} from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommandText } from '../src/adv-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountAdvMemoryServices } from '../src/memory-db.js';
import type { GameServices } from '../src/session-service.js';

function requireServices(): GameServices {
  return getGameServices<GameServices>() ?? mountAdvMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['冒险', 'adv', '秘境'],
  async run(action, input) {
    const normalized = normalizeAdvAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return ADV_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runAdvCommandText(services, message, normalized);
  },
});
