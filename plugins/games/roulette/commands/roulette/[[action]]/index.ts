import { gameCommandFeedback, gamePlayerFromInput, replyGameOperation } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { resolveRouletteFlow } from '../../../src/runtime.js';
import { getRouletteHelp, normalizeRouletteAction } from '../../../src/roulette-actions.js';
import { runRouletteCommand } from '../../../src/roulette-command.js';

export default defineCommand({
  description: '俄罗斯轮盘：多人轮流开枪，中弹者输', descriptionI18n: { en: "Russian roulette: take turns; the player hit loses" },
  alias: ['俄罗斯轮盘'],
  preferredAliasI18n: { 'zh-CN': '俄罗斯轮盘' },
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['open', 'join', 'start', 'fire', 'leave'], suggestionsI18n: { 'zh-CN': ['开局', '加入', '开始', '开枪', '离开'] } } },
  async execute(context) {
    const action = String(context.params.action ?? '');
    const normalized = normalizeRouletteAction(action);
    if (normalized === 'help') return getRouletteHelp(context);
    if (!normalized) return gameCommandFeedback(context, 'unknown', action) + '\n\n' + getRouletteHelp(context);
    const flow = resolveRouletteFlow(context), player = gamePlayerFromInput(context.input, context);
    await replyGameOperation({ session: flow.services.sessions, player, reply: context.session?.reply,
      run: () => runRouletteCommand(context, context.input, action) });
  },
});
