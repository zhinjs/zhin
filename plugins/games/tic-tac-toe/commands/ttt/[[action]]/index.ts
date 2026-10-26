import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeTttAction } from '@zhin.js/game-kit';
import { getTttHelp, runTttCommand } from '../../../src/ttt-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Tic Tac Toe',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return getTttHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runTttCommand(services, message, action);
  },
});
