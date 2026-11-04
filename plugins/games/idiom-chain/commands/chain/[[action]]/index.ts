import { replyGameOperation, gamePlayerFromInput, normalizeChainAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getChainHelp, runChainCommand } from '../../../src/chain-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Idiom Chain',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeChainAction(String(params.action ?? ''));
    if (!action || action === 'help') return getChainHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runChainCommand(services, message, action) });
  },
});
