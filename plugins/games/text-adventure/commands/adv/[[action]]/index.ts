import { replyGameOperation, gamePlayerFromInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getAdvHelp, runAdvCommand } from '../../../src/adv-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Text Adventure',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeAdvAction(String(params.action ?? ''));
    if (!action || action === 'help') return getAdvHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services.sessions, player: message, reply: session?.reply,
      run: () => runAdvCommand(services, message, action) });
  },
});
