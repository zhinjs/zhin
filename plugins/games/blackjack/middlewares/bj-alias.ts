import { defineGameCommandAliasMiddleware, messageFromCommandInput } from '@zhin.js/game-kit';
import { BJ_HELP, runBjCommandText } from '../src/bj-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

function normalizeBjAction(raw: string): string {
  const a = raw.trim().toLowerCase() || 'help';
  if (a === '帮助') return 'help';
  if (a === '开始') return 'start';
  if (a === '继续') return 'continue';
  return a;
}

export default defineGameCommandAliasMiddleware({
  aliases: ['21点', 'bj'],
  async run(action, input, context) {
    const normalized = normalizeBjAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return BJ_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runBjCommandText(services, message, normalized);
  },
});
