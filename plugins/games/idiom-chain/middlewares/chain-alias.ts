import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeChainAction,
} from '@zhin.js/game-kit';
import { CHAIN_HELP, runChainCommandText } from '../src/chain-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['接龙', 'chain'],
  async run(action, input, context) {
    const normalized = normalizeChainAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return CHAIN_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runChainCommandText(services, message, normalized);
  },
});
