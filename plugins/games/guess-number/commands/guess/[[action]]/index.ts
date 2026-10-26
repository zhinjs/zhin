import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeGuessAction } from '@zhin.js/game-kit';
import { getGuessHelp, runGuessCommand } from '../../../src/guess-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Guess Number',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeGuessAction(String(params.action ?? ''));
    if (!action || action === 'help') return getGuessHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runGuessCommand(services, message, action);
  },
});
