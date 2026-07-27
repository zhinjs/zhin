import {
  defineGameCommandAliasMiddleware,
  isDiceAction,
  messageFromCommandInput,
  normalizeDiceAction,
} from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommandText } from '../src/dice-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['骰子', 'dice'],
  async run(action, input, context) {
    const normalized = normalizeDiceAction(String(action ?? ''));
    if (normalized === 'help') return DICE_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isDiceAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runDiceCommandText(services, message, normalized);
  },
});
