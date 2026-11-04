import {
  replyGameOperation,
  defineGameCommandAliasMiddleware,
  isChainAction,
  gamePlayerFromInput,
  normalizeChainAction,
} from '@zhin.js/game-kit';
import { getChainHelp, runChainCommand } from '../../src/chain-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['接龙', 'chain'],
  async run(action, input, context) {
    const presentation = { locale: context.input.locale,
      formatCommand: (path: string) => context.input.formatCommand?.(path, context.owner.id) };

    const normalized = normalizeChainAction(String(action ?? ''));
    if (normalized === 'help') { await context.input.$reply(getChainHelp(presentation)); return true; }
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isChainAction(normalized)) return false;
    const message = gamePlayerFromInput(input, presentation);
    const services = resolveGameServices(context);
    await replyGameOperation({ session: services, player: message, reply: content => context.input.$reply(content),
      run: () => runChainCommand(services, message, normalized) });
    return true;
  },
});
