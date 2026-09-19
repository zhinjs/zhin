import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommand } from '../../src/dice-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Dice Duel',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const action = normalizeDiceAction(String(params.action ?? ''));
    if (!action || action === 'help') return DICE_HELP;
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input);
    return runDiceCommand(services, message, action);
  },
});
