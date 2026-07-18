import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommandText } from '../../src/adv-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountAdvMemoryServices } from '../../src/memory-db.js';
import type { GameServices } from '../../src/session-service.js';

function requireServices(): GameServices {
  return getGameServices<GameServices>() ?? mountAdvMemoryServices();
}

export default defineCommand({
  description: 'Text Adventure',
  async execute({ params, input }) {
    const action = normalizeAdvAction(String(params.action ?? ''));
    if (!action || action === 'help') return ADV_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runAdvCommandText(services, message, action);
  },
});
