import { defineGamePlugin, type InMemoryGameDb } from '@zhin.js/game-kit';
import { defineHostTables } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import { CHAIN_QUICK_START } from './src/chain-command.js';
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
  game: {
    commandPath: 'chain',
    titleI18n: { en: 'Chinese Idiom Chain' },
    descriptionI18n: { en: 'Connect Chinese idioms by sound or character' },
    quickStartI18n: { en: CHAIN_QUICK_START.en },
    id: 'chain',
    title: '成语接龙',
    icon: '📜',
    description: '四字成语接龙（同音/同字）',
    commandPrefix: '/接龙',
    // Chinese action words (`/接龙 同音`); `start_pinyin` / `start_char` remain accepted.
    quickStart: CHAIN_QUICK_START['zh-CN'],
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
