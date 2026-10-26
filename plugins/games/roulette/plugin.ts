import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import type { RouletteConfig } from './src/config.js';
import { ROULETTE_TABLES, defineHostTables, type RouletteSessionRow } from './src/models.js';
import { rouletteServicesToken } from './src/runtime.js';
import {
  createServices,
  type RouletteDatabase,
  type RouletteServices,
} from './src/session-service.js';

/**
 * Plugin Runtime wiring:
 * - `commands/roulette` and the `轮盘` alias middleware share one action runner.
 * - `middlewares/roulette-fire` lets the player on turn just say 「开枪」.
 * - Sessions use the host database when installed, otherwise memory.
 * - `schedules/deadlines` enforces turn and lobby timeouts and posts the result.
 * - Results feed game-hub records, so 「战绩」 and 「排行 轮盘」 work.
 */
export default defineGamePlugin<RouletteServices, RouletteSessionRow, Partial<RouletteConfig>>({
  name: 'roulette',
  metadata: {
    displayName: 'Russian Roulette',
  },
  game: {
    commandPath: 'roulette',
    titleI18n: { en: 'Roulette' },
    descriptionI18n: { en: 'Take turns in a multiplayer roulette game' },
    quickStartI18n: { en: 'open' },
    id: 'roulette',
    title: '俄罗斯轮盘',
    icon: '🔫',
    description: '多人轮流开枪，中弹者输；可按群开启禁言惩罚',
    commandPrefix: '/轮盘',
    quickStart: '开局',
    aliases: ['轮盘赌', 'roulette'],
    menus: [
      { id: 'open', label: '🎮 开局' },
      { id: 'join', label: '🙋 加入' },
      { id: 'help', label: '📖 玩法说明' },
    ],
  },
  tables: ROULETTE_TABLES,
  servicesToken: rouletteServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as RouletteDatabase),
  session: (services) => services.sessions,
  stale: false,
});
