import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommandText } from '../../src/dice-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountDiceMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountDiceMemoryServices();
}

export default defineCommand({
  description: 'Dice Duel',
  async execute({ params, input }) {
    const action = normalizeDiceAction(String(params.action ?? ''));
    if (!action || action === 'help') return DICE_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runDiceCommandText(services, message, action);
  },
});
