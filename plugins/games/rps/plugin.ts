import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type RpsDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles RPS choice payloads (Sandbox action→text).
 */
export default defineGamePlugin<SessionService>({
  name: 'rps',
  metadata: {
    displayName: 'RPS',
  },
  game: {
    id: 'rps',
    title: '猜拳对决',
    icon: '✊',
    description: '石头剪刀布，三局两胜',
    commandPrefix: '/猜拳',
    quickStart: '开始',
    aliases: ['rps'],
    menus: [
      { id: 'start', label: '🎮 开始对局' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['rps_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as RpsDatabase),
  session: (services) => services,
});
