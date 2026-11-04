import { replyGameOperation, gamePlayerFromInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getDiceHelp, runDiceCommand } from '../../../src/dice-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Dice Duel',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeDiceAction(String(params.action ?? ''));
    if (!action || action === 'help') return getDiceHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runDiceCommand(services, message, action) });
  },
});
