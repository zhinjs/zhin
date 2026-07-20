import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import { BJ_HELP, runBjCommandText } from '../../src/bj-command.js';
import { getGameServices } from '../../src/runtime-store.js';
import { mountBjMemoryServices } from '../../src/memory-db.js';
import type { SessionService } from '../../src/session-service.js';

function normalizeBjAction(raw: string): string {
  const a = raw.trim().toLowerCase() || 'help';
  if (a === '帮助') return 'help';
  if (a === '开始') return 'start';
  if (a === '继续') return 'continue';
  return a;
}

function requireServices(): SessionService {
  return getGameServices<SessionService>() ?? mountBjMemoryServices();
}

export default defineCommand({
  description: 'Blackjack',
  async execute({ params, input }) {
    const action = normalizeBjAction(String(params.action ?? ''));
    if (!action || action === 'help') return BJ_HELP;
    const services = requireServices();
    const message = messageFromCommandInput(input);
    return runBjCommandText(services, message, action);
  },
});
