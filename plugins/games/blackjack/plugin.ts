import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type BjDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles hit/stand payloads (Sandbox action→text).
 */
export default defineGamePlugin<SessionService>({
  name: 'blackjack',
  metadata: {
    displayName: 'Blackjack',
  },
  game: {
    id: 'blackjack',
    title: '21 点',
    icon: '🃏',
    description: '经典 Blackjack，要牌或停牌挑战庄家',
    commandPrefix: '/21点',
    quickStart: '开始',
    aliases: ['bj', '21点'],
    menus: [
      { id: 'start', label: '🎮 开始新局' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['bj_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as BjDatabase),
  session: (services) => services,
});
