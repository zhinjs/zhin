import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommandText } from '../../src/riddle-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountRiddleMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountRiddleMemoryServices();
}

export default defineCommand({
  description: 'Word Riddle',
  async execute({ params, input }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return RIDDLE_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runRiddleCommandText(services, message, action);
  },
});
