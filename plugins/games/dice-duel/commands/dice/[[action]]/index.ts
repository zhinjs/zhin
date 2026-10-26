import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { getDiceHelp, runDiceCommand } from '../../../src/dice-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Dice Duel',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeDiceAction(String(params.action ?? ''));
    if (!action || action === 'help') return getDiceHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runDiceCommand(services, message, action);
  },
});
