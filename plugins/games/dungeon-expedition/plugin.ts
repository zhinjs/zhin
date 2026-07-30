import {
  defineGamePlugin,
  type InMemoryGameDb,
} from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type DungeonDatabase,
  type SessionService,
} from './src/session-service.js';

export default defineGamePlugin<SessionService>({
  name: 'dungeon-expedition',
  metadata: {
    displayName: 'Dungeon Expedition',
  },
  game: {
    id: 'dungeon',
    title: '地牢远征',
    icon: '⚔️',
    description: '1-4 人组队，三层地牢，确定性回合冒险',
    commandPrefix: '/地牢',
    quickStart: '开始',
    aliases: ['dungeon'],
    menus: [
      { id: 'create', label: '创建远征队' },
      { id: 'join', label: '加入队伍' },
      { id: 'status', label: '当前状态' },
      { id: 'help', label: '玩法说明' },
    ],
  },
  tables: ['dungeon_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as DungeonDatabase),
  session: (service) => service,
  stale: {
    idleMs: 30 * 60_000,
    message: '地牢远征因 30 分钟无人操作，已自动结束。',
  },
});
