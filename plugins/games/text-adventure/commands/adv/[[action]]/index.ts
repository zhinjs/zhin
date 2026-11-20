import { gameActionWords, gameCommandAction, gameCommandMatch, replyGameOperation, gamePlayerFromInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getAdvHelp, runAdvCommand } from '../../../src/adv-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '文字冒险',
  descriptionI18n: { en: 'Text Adventure' },
  alias: ['文字冒险'],
  preferredAliasI18n: { 'zh-CN': '文字冒险' },
  // Short chat words are no alias: only the bare word or the word plus a known action is this command (#1250 第 82 批).
  match: gameCommandMatch(['冒险', '秘境'], gameActionWords('adv')),
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, match, input, use, locale, formatCommand, session }) {
    const action = normalizeAdvAction(gameCommandAction({ params, match }));
    if (!action || action === 'help') return getAdvHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services.sessions, player: message, reply: session?.reply,
      run: () => runAdvCommand(services, message, action) });
  },
});
