import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import { getBjHelp, runBjCommand } from '../../../src/bj-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

function normalizeBjAction(raw: string): string {
  const a = raw.trim().toLowerCase() || 'help';
  if (a === '帮助') return 'help';
  if (a === '开始') return 'start';
  if (a === '继续') return 'continue';
  return a;
}

export default defineCommand({
  description: 'Blackjack',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const action = normalizeBjAction(String(params.action ?? ''));
    if (!action || action === 'help') return getBjHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = messageFromCommandInput(input, { locale, formatCommand });
    return runBjCommand(services, message, action);
  },
});
