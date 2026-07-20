import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeRiddleAction,
} from '@zhin.js/game-kit';
import { RIDDLE_HELP, runRiddleCommandText } from '../src/riddle-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['猜谜', 'riddle'],
  async run(action, input, context) {
    const normalized = normalizeRiddleAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return RIDDLE_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runRiddleCommandText(services, message, normalized);
  },
});
