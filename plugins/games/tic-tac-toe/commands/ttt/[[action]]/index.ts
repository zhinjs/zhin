import { replyGameOperation, gamePlayerFromInput, normalizeTttAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getTttHelp, runTttCommand } from '../../../src/ttt-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '井字棋：两人轮流落子',
  descriptionI18n: { en: 'Tic Tac Toe' },
  // 与游戏标题「井字棋」一致；旧名「井字游戏」保留为别名。
  alias: ['井字棋', '井字游戏'],
  preferredAliasI18n: { 'zh-CN': '井字棋' },
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['bot', 'join', 'leave', 'quit', 'spectate'], suggestionsI18n: { 'zh-CN': ['人机', '加入', '离开', '认输', '观战'] } } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeTttAction(String(params.action ?? ''));
    if (!action || action === 'help') return getTttHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services.session, player: message, reply: session?.reply,
      run: () => runTttCommand(services, message, action) });
  },
});
