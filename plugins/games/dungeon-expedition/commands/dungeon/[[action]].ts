import { defineCommand } from '@zhin.js/command';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import {
  DUNGEON_HELP,
  normalizeDungeonAction,
  runDungeonCommand,
} from '../../src/dungeon-command.js';
import { resolveGameServices } from '../../src/runtime-store.js';

export default defineCommand({
  description: 'Multiplayer dungeon expedition',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, owner }) {
    const rawAction = String(params.action ?? '');
    if (normalizeDungeonAction(rawAction) === 'help') return DUNGEON_HELP;
    const service = resolveGameServices({ use, owner });
    return runDungeonCommand(
      service,
      messageFromCommandInput(input),
      rawAction,
    );
  },
});
