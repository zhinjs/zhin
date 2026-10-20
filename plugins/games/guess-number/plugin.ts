import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type GuessDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Digit middleware under `middlewares/` handles bare-number guesses.
 */
export default defineGamePlugin<SessionService>({
  name: 'guess-number',
  metadata: {
    displayName: 'Guess Number',
  },
  game: {
    id: 'guess',
    title: '猜数字',
    icon: '🔢',
    description: '1~100 七步猜中神秘数',
    commandPrefix: '/猜数',
    quickStart: '开始',
    aliases: ['guess'],
    menus: [
      { id: 'start', label: '🎮 开始新局' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['guess_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as GuessDatabase),
  session: (services) => services,
});
