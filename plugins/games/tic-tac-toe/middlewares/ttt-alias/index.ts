import { replyGameOperation, defineGameCommandAliasMiddleware, isTttAction, gamePlayerFromInput, normalizeTttAction } from '@zhin.js/game-kit';
import { getTttHelp, runTttCommand } from '../../src/ttt-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['井字棋', 'ttt'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeTttAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getTttHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isTttAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services.session, player: message, reply: content => context.input.$reply(content),
      run: () => runTttCommand(services, message, normalized) });
    return true;
  },
});
