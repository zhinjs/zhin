import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import {
  createServices,
  type DiceDatabase,
  type SessionService,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles dice roll payloads (Sandbox action→text).
 */
export default defineGamePlugin<SessionService>({
  name: 'dice-duel',
  metadata: {
    displayName: 'Dice Duel',
  },
  game: {
    id: 'dice',
    title: '骰子对决',
    icon: '🎲',
    description: '掷骰比大小，三局两胜',
    commandPrefix: '/骰子',
    quickStart: '开始',
    aliases: ['dice'],
    menus: [
      { id: 'start', label: '🎮 开始对局' },
      { id: 'continue', label: '🔄 继续' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ['dice_sessions'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as DiceDatabase),
  session: (services) => services,
});
