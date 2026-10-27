import {
  defineGameCommandAliasMiddleware,
  isTttAction,
  messageFromCommandInput,
  normalizeTttAction,
} from '@zhin.js/game-kit';
import { getTttHelp, runTttCommand } from '../../src/ttt-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['井字棋', 'ttt'],
  async run(action, input, context) {
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeTttAction(String(action ?? ''));
    if (normalized === 'help') return getTttHelp(message);
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isTttAction(normalized)) return null;
    const services = resolveGameServices(context);
    return runTttCommand(services, message, normalized);
  },
});
