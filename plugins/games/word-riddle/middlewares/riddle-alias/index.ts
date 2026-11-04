import {
  replyGameOperation,
  defineGameCommandAliasMiddleware,
  isRiddleAction,
  gamePlayerFromInput,
  normalizeRiddleAction,
} from '@zhin.js/game-kit';
import { getRiddleHelp, runRiddleCommand } from '../../src/riddle-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜谜', 'riddle'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeRiddleAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getRiddleHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isRiddleAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => runRiddleCommand(services, message, normalized) });
    return true;
  },
});
