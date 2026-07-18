import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeTttAction,
} from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommandText } from '../src/ttt-command.js';
import { getGameServices } from '../src/runtime-store.js';
import { mountTttMemoryServices } from '../src/memory-db.js';
import type { SessionServices } from '../src/session-service.js';

function requireServices(): SessionServices {
  return getGameServices<SessionServices>() ?? mountTttMemoryServices();
}

export default defineGameCommandAliasMiddleware({
  aliases: ['井字棋', 'ttt'],
  async run(action, input) {
    const normalized = normalizeTttAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return TTT_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runTttCommandText(services, message, normalized);
  },
});
