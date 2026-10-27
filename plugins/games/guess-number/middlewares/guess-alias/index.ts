import {
  defineGameCommandAliasMiddleware,
  isGuessAction,
  messageFromCommandInput,
  normalizeGuessAction,
} from '@zhin.js/game-kit';
import { getGuessHelp, runGuessCommand } from '../../src/guess-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜数', 'guess'],
  async run(action, input, context) {
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeGuessAction(String(action ?? ''));
    if (normalized === 'help') return getGuessHelp(message);
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isGuessAction(normalized)) return null;
    const services = resolveGameServices(context);
    return runGuessCommand(services, message, normalized);
  },
});
