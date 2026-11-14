import { replyGameOperation, gamePlayerFromInput } from '@zhin.js/game-kit';
import { defineCommand } from 'zhin.js/command';
import {
  getDungeonHelp,
  normalizeDungeonAction,
  runDungeonCommand,
} from '../../../src/dungeon-command.js';
import { resolveGameServices } from '../../../src/runtime-store.js';

export default defineCommand({
  description: '地牢远征：多人组队探索地牢',
  descriptionI18n: { en: 'Multiplayer dungeon expedition' },
  alias: ['地牢远征'],
  preferredAliasI18n: { 'zh-CN': '地牢远征' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, input, use, locale, formatCommand, session }) {
    const rawAction = String(params.action ?? '');
    if (normalizeDungeonAction(rawAction) === 'help') return getDungeonHelp({ locale, formatCommand });
    const service = resolveGameServices({ use });
    const player = gamePlayerFromInput(input, { locale, formatCommand });
    await replyGameOperation({ session: service, player, reply: session?.reply,
      run: () => runDungeonCommand(service, player, rawAction) });
  },
});
