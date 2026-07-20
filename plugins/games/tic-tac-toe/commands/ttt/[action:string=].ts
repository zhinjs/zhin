import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeTttAction } from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommandText } from '../../src/ttt-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountTttMemoryServices } from '../../src/memory-db.js';
import type { SessionServices } from '../../src/session-service.js';

function requireServices(): SessionServices {
  return getGameServices<SessionServices>() ?? mountTttMemoryServices();
}

export default defineCommand({
  description: 'Tic Tac Toe',
  async execute({ params, input }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return TTT_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runTttCommandText(services, message, action);
  },
});
