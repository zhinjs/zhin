import {
  defineGameCommandAliasMiddleware,
  isDiceAction,
  messageFromCommandInput,
  normalizeDiceAction,
} from '@zhin.js/game-kit';
import { getDiceHelp, runDiceCommand } from '../../src/dice-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['骰子', 'dice'],
  async run(action, input, context) {
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeDiceAction(String(action ?? ''));
    if (normalized === 'help') return getDiceHelp(message);
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isDiceAction(normalized)) return null;
    const services = resolveGameServices(context);
    return runDiceCommand(services, message, normalized);
  },
});
