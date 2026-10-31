import { replyGameOperation, defineGameCommandAliasMiddleware, gamePlayerFromInput } from '@zhin.js/game-kit';
import {
  normalizeDungeonAction,
  getDungeonHelp,
  runDungeonCommand,
} from '../../src/dungeon-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineGameCommandAliasMiddleware({
  aliases: ['地牢', 'dungeon'],
  async run(action, input, context) {
    const normalized = normalizeDungeonAction(action);
    if (normalized === null) return false;
    if (normalized === 'help') {
      await context.input.$reply(getDungeonHelp({ locale: context.input.locale,
        formatCommand: path => context.input.formatCommand?.(path, context.owner.id) }));
      return true;
    }
    const services = resolveGameServices(context), player = gamePlayerFromInput(input);
    await replyGameOperation({ session: services, player, reply: content => context.input.$reply(content),
      run: () => runDungeonCommand(services, player, action) });
    return true;
  },
});
