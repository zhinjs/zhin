import { replyGameOperation, gamePlayerFromInput, normalizeTttAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getTttHelp, runTttCommand } from '../../../src/ttt-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '井字棋：两人轮流落子',
  descriptionI18n: { en: 'Tic Tac Toe' },
  alias: ['井字游戏'],
  preferredAliasI18n: { 'zh-CN': '井字游戏' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return getTttHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services.session, player: message, reply: session?.reply,
      run: () => runTttCommand(services, message, action) });
  },
});
