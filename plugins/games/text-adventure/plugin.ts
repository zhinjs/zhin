import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type AdvDatabase,
  type GameServices,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/…).
 * - DB: prefer databaseHostToken; else in-memory GameServices.
 * - Choice middleware under `middlewares/` handles adv choice payloads (Sandbox action→text).
 */
export default defineGamePlugin<GameServices>({
  name: 'text-adventure',
  metadata: {
    displayName: 'Text Adventure',
  },
  game: {
    id: 'adv',
    title: '秘境探险',
    icon: '🗺️',
    description: '文字冒险，31 区域 · 15 结局 · 成就收集',
    commandPrefix: '/冒险',
    quickStart: '开始',
    aliases: ['adv', '秘境'],
    menus: [
      { id: 'start', label: '🚪 开始冒险' },
      { id: 'continue', label: '🔄 继续冒险' },
      { id: 'map', label: '🗺️ 探索进度' },
      { id: 'achievements', label: '🏅 成就' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['adv_sessions', 'adv_profiles'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as AdvDatabase),
  session: (services) => services.sessions,
});
