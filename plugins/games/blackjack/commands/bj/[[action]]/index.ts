import { gameActionWords, gameCommandAction, gameCommandMatch, normalizeBjAction, replyGameOperation, gamePlayerFromInput } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getBjHelp, runBjCommand } from '../../../src/bj-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '二十一点：和庄家比点数',
  descriptionI18n: { en: 'Blackjack: beat the dealer' },
  // Not bare `二十一点` as an alias: it is also a time of day, and an alias takes whatever follows it
  // (`二十一点 开会` would be this command with action `开会`).
  alias: ['玩二十一点'],
  preferredAliasI18n: { 'zh-CN': '玩二十一点' },
  // #1250 第 82 批: the short words only as the bare word or the word plus a known action
  // (`二十一点 要牌`); `二十一点 开会` stays chat.
  match: gameCommandMatch(['21点', '二十一点'], gameActionWords('bj')),
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, match, input, use, locale, formatCommand, session }) {
    const action = normalizeBjAction(gameCommandAction({ params, match }));
    if (action === 'help') return getBjHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runBjCommand(services, message, action) });
  },
});
