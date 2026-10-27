import {
  defineGameCommandAliasMiddleware,
  isRpsAction,
  messageFromCommandInput,
  normalizeRpsAction,
} from '@zhin.js/game-kit';
import { getRpsHelp, runRpsCommand } from '../../src/rps-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜拳', 'rps'],
  async run(action, input, context) {
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeRpsAction(String(action ?? ''));
    if (normalized === 'help') return getRpsHelp(message);
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isRpsAction(normalized)) return null;
    const services = resolveGameServices(context);
    return runRpsCommand(services, message, normalized);
  },
});
