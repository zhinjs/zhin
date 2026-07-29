import {
  defineGameCommandAliasMiddleware,
  isChainAction,
  messageFromCommandInput,
  normalizeChainAction,
} from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommand } from '../src/chain-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['接龙', 'chain'],
  async run(action, input, context) {
    const normalized = normalizeChainAction(String(action ?? ''));
    if (normalized === 'help') return CHAIN_HELP;
    // action 无法识别：放行给后续中间件，避免劫持普通聊天
    if (!isChainAction(normalized)) return null;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runChainCommand(services, message, normalized);
  },
});
