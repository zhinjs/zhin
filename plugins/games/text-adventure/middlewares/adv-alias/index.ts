import { replyGameOperation, defineGameCommandAliasMiddleware, isAdvAction, gamePlayerFromInput, normalizeAdvAction } from '@zhin.js/game-kit';
import { getAdvHelp, runAdvCommand } from '../../src/adv-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['冒险', 'adv', '秘境'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeAdvAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getAdvHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isAdvAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services.sessions, player: message, reply: content => context.input.$reply(content),
      run: () => runAdvCommand(services, message, normalized) });
    return true;
  },
});
