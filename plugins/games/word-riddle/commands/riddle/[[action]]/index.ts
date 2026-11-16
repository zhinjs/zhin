import { replyGameOperation, gamePlayerFromInput, normalizeRiddleAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getRiddleHelp, runRiddleCommand } from '../../../src/riddle-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '猜谜语',
  descriptionI18n: { en: 'Word Riddle' },
  alias: ['猜谜语'],
  preferredAliasI18n: { 'zh-CN': '猜谜语' },
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeRiddleAction(String(params.action ?? ''));
    if (!action || action === 'help') return getRiddleHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runRiddleCommand(services, message, action) });
  },
});
