import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeRpsAction,
} from '@zhin.js/game-kit';
import { RPS_HELP, runRpsCommandText } from '../src/rps-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜拳', 'rps'],
  async run(action, input, context) {
    const normalized = normalizeRpsAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return RPS_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runRpsCommandText(services, message, normalized);
  },
});
