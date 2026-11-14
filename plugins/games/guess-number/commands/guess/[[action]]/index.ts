import { replyGameOperation, gamePlayerFromInput, normalizeGuessAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getGuessHelp, runGuessCommand } from '../../../src/guess-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '猜数字：1~100 之间猜一个整数',
  descriptionI18n: { en: 'Guess Number: find the integer between 1 and 100' },
  alias: ['猜数字'],
  preferredAliasI18n: { 'zh-CN': '猜数字' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeGuessAction(String(params.action ?? ''));
    if (!action || action === 'help') return getGuessHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runGuessCommand(services, message, action) });
  },
});
