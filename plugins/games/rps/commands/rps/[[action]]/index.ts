import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { getRpsHelp, runRpsCommand } from '../../../src/rps-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'RPS',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeRpsAction(String(params.action ?? ''));
    if (!action || action === 'help') return getRpsHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runRpsCommand(services, message, action);
  },
});
