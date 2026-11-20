import { gameActionWords, gameCommandAction, gameCommandMatch, replyGameOperation, gamePlayerFromInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getRpsHelp, runRpsCommand } from '../../../src/rps-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';
import { RPS_ENTRY_MOVE_WORDS } from '../../../src/engine.js';

export default defineCommand({
  description: '石头剪刀布：和机器人猜拳',
  descriptionI18n: { en: 'Rock, paper, scissors against the bot' },
  // Not bare `石头剪刀布`: group chat uses it to settle things (`石头剪刀布 谁输谁请客`).
  alias: ['玩石头剪刀布'],
  preferredAliasI18n: { 'zh-CN': '玩石头剪刀布' },
  // #1250 第 82 批: `猜拳` only bare, with a known action or with a move (`猜拳 石头` starts and plays it).
  match: gameCommandMatch(['猜拳'], [...gameActionWords('rps'), ...RPS_ENTRY_MOVE_WORDS]),
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, match, input, use, locale, formatCommand, session }) {
    const action = normalizeRpsAction(gameCommandAction({ params, match }));
    if (!action || action === 'help') return getRpsHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runRpsCommand(services, message, action) });
  },
});
