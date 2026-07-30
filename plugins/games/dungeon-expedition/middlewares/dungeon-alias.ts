import {
  defineGameCommandAliasMiddleware,
  messageFromCommandInput,
} from '@zhin.js/game-kit';
import {
  normalizeDungeonAction,
  runDungeonCommand,
} from '../src/dungeon-command.js';
import { resolveGameServices } from '../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['地牢', 'dungeon'],
  async run(action, input, context) {
    if (normalizeDungeonAction(action) === null) return null;
    return runDungeonCommand(
      resolveGameServices(context),
      messageFromCommandInput(input),
      action,
    );
  },
});
