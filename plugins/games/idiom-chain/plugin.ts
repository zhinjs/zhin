import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type ChainDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Text middleware under `middlewares/` handles idiom answer payloads.
 */
export default defineGamePlugin<SessionService>({
  name: 'idiom-chain',
  metadata: {
    displayName: 'Idiom Chain',
  },
  game: {
    id: 'chain',
    title: '成语接龙',
    icon: '📜',
    description: '四字成语接龙（同音/同字）',
    commandPrefix: '/接龙',
    quickStart: 'start_pinyin',
    aliases: ['chain'],
    menus: [
      { id: 'start_pinyin', label: '🎮 同音接龙' },
      { id: 'start_char', label: '📝 同字接龙' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['idiom_chain_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as ChainDatabase),
  session: (services) => services,
});
