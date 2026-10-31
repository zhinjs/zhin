import { replyGameOperation, gamePlayerFromInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getRiddleHelp, runRiddleCommand } from '../../../src/riddle-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Word Riddle',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return getRiddleHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runRiddleCommand(services, message, action) });
  },
});
