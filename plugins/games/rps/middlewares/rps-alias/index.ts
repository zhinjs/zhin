import { replyGameOperation, defineGameCommandAliasMiddleware, isRpsAction, gamePlayerFromInput, normalizeRpsAction } from '@zhin.js/game-kit';
import { getRpsHelp, runRpsCommand } from '../../src/rps-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';
import { parseMove } from '../../src/engine.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜拳', 'rps'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeRpsAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getRpsHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    // 「猜拳 石头」开局并出拳；单字母 r/p/s 不算，免得劫持普通聊天。
    const isMove = parseMove(normalized) !== null && !/^[a-z]$/u.test(normalized);
    if (!isRpsAction(normalized) && !isMove) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => runRpsCommand(services, message, normalized) });
    return true;
  },
});
