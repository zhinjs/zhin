import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeAdvAction,
} from '@zhin.js/game-kit';
import { ADV_HELP, runAdvCommandText } from '../src/adv-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['冒险', 'adv', '秘境'],
  async run(action, input, context) {
    const normalized = normalizeAdvAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return ADV_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runAdvCommandText(services, message, normalized);
  },
});
