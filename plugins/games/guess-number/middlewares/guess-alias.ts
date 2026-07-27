import {
  defineGameCommandAliasMiddleware,
  isGuessAction,
  messageFromCommandInput,
  normalizeGuessAction,
} from '@zhin.js/game-kit';
import { GUESS_HELP, runGuessCommand } from '../src/guess-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜数', 'guess'],
  async run(action, input, context) {
    const normalized = normalizeGuessAction(String(action ?? ''));
    if (normalized === 'help') return GUESS_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isGuessAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runGuessCommand(services, message, normalized);
  },
});
