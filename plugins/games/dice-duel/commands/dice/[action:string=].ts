import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommandText } from '../../src/dice-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Dice Duel',
  async execute({ params, input, use, owner }) {
    const action = normalizeDiceAction(String(params.action ?? ''));
    if (!action || action === 'help') return DICE_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runDiceCommandText(services, message, action);
  },
});
