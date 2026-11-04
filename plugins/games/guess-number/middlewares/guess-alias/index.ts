import {
  replyGameOperation,
  defineGameCommandAliasMiddleware,
  isGuessAction,
  gamePlayerFromInput,
  normalizeGuessAction,
} from '@zhin.js/game-kit';
import { getGuessHelp, runGuessCommand } from '../../src/guess-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜数', 'guess'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeGuessAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getGuessHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isGuessAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => runGuessCommand(services, message, normalized) });
    return true;
  },
});
