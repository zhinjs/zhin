import {
  defineGameCommandAliasMiddleware,
  isAdvAction,
  messageFromCommandInput,
  normalizeAdvAction,
} from '@zhin.js/game-kit';
import { getAdvHelp, runAdvCommand } from '../../src/adv-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['冒险', 'adv', '秘境'],
  async run(action, input, context) {
    const message = messageFromCommandInput(input, {
      formatCommand: (path) => context.input.formatCommand?.(path, context.owner.id),
    });
    const normalized = normalizeAdvAction(String(action ?? ''));
    if (normalized === 'help') return getAdvHelp(message);
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isAdvAction(normalized)) return null;
    const services = resolveGameServices(context);
    return runAdvCommand(services, message, normalized);
  },
});
