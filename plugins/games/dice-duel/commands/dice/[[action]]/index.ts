import { gameActionWords, gameCommandAction, gameCommandMatch, replyGameOperation, gamePlayerFromInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getDiceHelp, runDiceCommand } from '../../../src/dice-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '骰子对决：掷骰比大小',
  descriptionI18n: { en: 'Dice Duel: roll and compare' },
  alias: ['骰子对决'],
  preferredAliasI18n: { 'zh-CN': '骰子对决' },
  // Short chat words are no alias: only the bare word or the word plus a known action is this command (#1250 第 82 批).
  match: gameCommandMatch(['骰子'], gameActionWords('dice')),
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, match, input, use, locale, formatCommand, session }) {
    const action = normalizeDiceAction(gameCommandAction({ params, match }));
    if (!action || action === 'help') return getDiceHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runDiceCommand(services, message, action) });
  },
});
