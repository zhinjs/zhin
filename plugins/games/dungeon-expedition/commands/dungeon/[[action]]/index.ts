import { defineCommand } from 'zhin.js/command';
import { messageFromCommandInput } from '@zhin.js/game-kit';
import {
  getDungeonHelp,
  normalizeDungeonAction,
  runDungeonCommand,
} from '../../../src/dungeon-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: 'Multiplayer dungeon expedition',
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand }) {
    const rawAction = String(params.action ?? '');
    if (normalizeDungeonAction(rawAction) === 'help') return getDungeonHelp({ locale, formatCommand });
    const service = resolveGameServices({ use });
    return runDungeonCommand(
      service,
      messageFromCommandInput(input, { locale, formatCommand }),
      rawAction,
    );
  },
});
