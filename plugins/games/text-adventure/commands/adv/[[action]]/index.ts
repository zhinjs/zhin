import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { getAdvHelp, runAdvCommand } from '../../../src/adv-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Text Adventure',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeAdvAction(String(params.action ?? ''));
    if (!action || action === 'help') return getAdvHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runAdvCommand(services, message, action);
  },
});
