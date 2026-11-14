import { replyGameOperation, gamePlayerFromInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import { getRpsHelp, runRpsCommand } from '../../../src/rps-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '石头剪刀布：和机器人猜拳',
  descriptionI18n: { en: 'Rock, paper, scissors against the bot' },
  // Not bare `石头剪刀布`: group chat uses it to settle things (`石头剪刀布 谁输谁请客`).
  alias: ['玩石头剪刀布'],
  preferredAliasI18n: { 'zh-CN': '玩石头剪刀布' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const action = normalizeRpsAction(String(params.action ?? ''));
    if (!action || action === 'help') return getRpsHelp({ locale, formatCommand });
    const services = resolveGameServices({ use });
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: services, player: message, reply: session?.reply,
      run: () => runRpsCommand(services, message, action) });
  },
});
