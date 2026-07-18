import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountChainHostServices, mountChainMemoryServices } from './src/memory-db.js';
import { getGameServices } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Text middleware under `middlewares/` handles idiom answer payloads.
 * - TODO: interactive handlers (buttons still deferred).
 */
export default definePlugin({
  name: 'idiom-chain',
  metadata: {
    displayName: 'Idiom Chain',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      mountChainHostServices(host);
      initGameRecordHost(host);
    } else {
      mountChainMemoryServices();
    }
    const disposeHub = registerRuntimeGame({
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
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'chain/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale idiom-chain sessions',
        async execute() {
          const services = getGameServices<SessionService>();
          if (!services?.abortStale) return;
          await services.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
