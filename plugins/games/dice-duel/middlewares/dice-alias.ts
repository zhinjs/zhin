import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeDiceAction,
} from '@zhin.js/game-kit';
import { DICE_HELP, runDiceCommandText } from '../src/dice-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['骰子', 'dice'],
  async run(action, input, context) {
    const normalized = normalizeDiceAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return DICE_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runDiceCommandText(services, message, normalized);
  },
});
