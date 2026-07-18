import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeGuessAction } from '@zhin.js/game-kit';
import { GUESS_HELP, runGuessCommand } from '../../src/guess-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountGuessMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountGuessMemoryServices();
}

export default defineCommand({
  description: 'Guess Number',
  async execute({ params, input }) {
    const action = normalizeGuessAction(String(params.action ?? ''));
    if (!action || action === 'help') return GUESS_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runGuessCommand(services, message, action);
  },
});
