import { replyGameOperation, gamePlayerFromInput } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getBjHelp, runBjCommand } from '../../../src/bj-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

function normalizeBjAction(raw: string): string {
  const a = raw.trim().toLowerCase() || 'help';
  if (a === '帮助') return 'help';
  if (a === '开始') return 'start';
  if (a === '继续') return 'continue';
  if (a === '退出' || a === '放弃') return 'quit';
  return a;
}

export default defineCommand({
  description: '二十一点：和庄家比点数',
  descriptionI18n: { en: 'Blackjack: beat the dealer' },
  // Not bare `二十一点`: it is also a time of day (`二十一点 开会`).
  alias: ['玩二十一点'],
  preferredAliasI18n: { 'zh-CN': '玩二十一点' },
  params: { action: { type: 'string', default: '',
    // 近似指令提示里列出真实子命令，而不是 `[action]`（#1250）。
    suggestions: ['start', 'continue', 'quit'], suggestionsI18n: { 'zh-CN': ['开始', '继续', '退出'] } } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeBjAction(String(params.action ?? ''));
    if (!action || action === 'help') return getBjHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runBjCommand(services, message, action) });
  },
});
