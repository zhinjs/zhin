import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { getRiddleHelp, runRiddleCommand } from '../../../src/riddle-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Word Riddle',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return getRiddleHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runRiddleCommand(services, message, action);
  },
});
