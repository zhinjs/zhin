import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { RPS_HELP, runRpsCommandText } from '../../src/rps-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountRpsMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountRpsMemoryServices();
}

export default defineCommand({
  description: 'RPS',
  async execute({ params, input }) {
    const action = normalizeRpsAction(String(params.action ?? ''));
    if (!action || action === 'help') return RPS_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runRpsCommandText(services, message, action);
  },
});
