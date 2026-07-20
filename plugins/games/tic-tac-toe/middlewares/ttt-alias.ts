import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
  normalizeTttAction,
} from '@zhin.js/game-kit';
import { TTT_HELP, runTttCommandText } from '../src/ttt-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['井字棋', 'ttt'],
  async run(action, input, context) {
    const normalized = normalizeTttAction(String(action ?? ''));
    if (!normalized || normalized === 'help') return TTT_HELP;
    const services = resolveGameServices(context);
    const message = messageFromCommandInput(input);
    return runTttCommandText(services, message, normalized);
  },
});
