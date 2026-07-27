import {
  defineGameCommandAliasMiddleware,
  isAdvAction,
  messageFromCommandInput,
  normalizeAdvAction,
} from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommandText } from '../src/adv-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['冒险', 'adv', '秘境'],
  async run(action, input, context) {
    const normalized = normalizeAdvAction(String(action ?? ''));
    if (normalized === 'help') return ADV_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isAdvAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runAdvCommandText(services, message, normalized);
  },
});
