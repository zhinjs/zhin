import { replyGameOperation, gamePlayerFromInput } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
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
  description: '二十一点：和庄家比点数',
  descriptionI18n: { en: 'Blackjack: beat the dealer' },
  alias: ['二十一点'],
  preferredAliasI18n: { 'zh-CN': '二十一点' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeBjAction(String(params.action ?? ''));
    if (!action || action === 'help') return getBjHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runBjCommand(services, message, action) });
  },
});
