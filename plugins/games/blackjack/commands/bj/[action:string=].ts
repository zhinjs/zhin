import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import { BJ_HELP, runBjCommandText } from '../../src/bj-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

function normalizeBjAction(raw: string): string {
  const a = raw.trim().toLowerCase() || 'help';
  if (a === '帮助') return 'help';
  if (a === '开始') return 'start';
  if (a === '继续') return 'continue';
  return a;
}

export default defineCommand({
  description: 'Blackjack',
  async execute({ params, input, use, owner }) {
    const action = normalizeBjAction(String(params.action ?? ''));
    if (!action || action === 'help') return BJ_HELP;
    const services = resolveGameServices({ use, owner });
    const message = messageFromCommandInput(input);
    return runBjCommandText(services, message, action);
  },
});
