import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountRiddleHostServices, mountRiddleMemoryServices } from './src/memory-db.js';
import { getGameServices } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Text middleware under `middlewares/` handles answer payloads.
 * - TODO: interactive handlers (buttons still deferred).
 */
export default definePlugin({
  name: 'word-riddle',
  metadata: {
    displayName: 'Word Riddle',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      mountRiddleHostServices(host);
      initGameRecordHost(host);
    } else {
      mountRiddleMemoryServices();
    }
    const disposeHub = registerRuntimeGame({
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
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'riddle/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale word-riddle sessions',
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
