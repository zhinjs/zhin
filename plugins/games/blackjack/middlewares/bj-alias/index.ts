import { defineGameCommandAliasMiddleware, messageFromCommandInput } from '@zhin.js/game-kit';
import { getBjHelp, runBjCommand } from '../../src/bj-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

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
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeBjAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return getBjHelp(message);
    const services = resolveGameServices(context);
    return runBjCommand(services, message, normalized);
  },
});
