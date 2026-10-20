import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type RiddleDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Text middleware under `middlewares/` handles answer payloads.
 */
export default defineGamePlugin<SessionService>({
  name: 'word-riddle',
  metadata: {
    displayName: 'Word Riddle',
  },
  game: {
    id: 'riddle',
    title: '猜谜',
    icon: '🧩',
    description: '字谜 + 成语猜谜',
    commandPrefix: '/猜谜',
    quickStart: '开始',
    aliases: ['riddle'],
    menus: [
      { id: 'char', label: '🔤 字谜模式' },
      { id: 'idiom', label: '📜 成语模式' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['word_riddle_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as RiddleDatabase),
  session: (services) => services,
});
