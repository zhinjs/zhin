import {
  defineGameCommandAliasMiddleware,
  isTttAction,
  messageFromCommandInput,
  normalizeTttAction,
} from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommandText } from '../src/ttt-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['井字棋', 'ttt'],
  async run(action, input, context) {
    const normalized = normalizeTttAction(String(action ?? ''));
    if (normalized === 'help') return TTT_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isTttAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runTttCommandText(services, message, normalized);
  },
});
