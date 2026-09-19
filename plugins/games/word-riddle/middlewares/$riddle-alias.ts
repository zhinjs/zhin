import {
  defineGameCommandAliasMiddleware,
  isRiddleAction,
  messageFromCommandInput,
  normalizeRiddleAction,
} from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommand } from '../src/riddle-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜谜', 'riddle'],
  async run(action, input, context) {
    const normalized = normalizeRiddleAction(String(action ?? ''));
    if (normalized === 'help') return RIDDLE_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isRiddleAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runRiddleCommand(services, message, normalized);
  },
});
