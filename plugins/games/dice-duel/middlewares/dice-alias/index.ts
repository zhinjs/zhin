import { replyGameOperation, defineGameCommandAliasMiddleware, isDiceAction, gamePlayerFromInput, normalizeDiceAction } from '@zhin.js/game-kit';
import { getDiceHelp, runDiceCommand } from '../../src/dice-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['骰子', 'dice'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeDiceAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getDiceHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isDiceAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => runDiceCommand(services, message, normalized) });
    return true;
  },
});
