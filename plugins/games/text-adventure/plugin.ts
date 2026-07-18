import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountAdvHostServices, mountAdvMemoryServices } from './src/memory-db.js';
import { getGameServices } from './src/runtime-store.js';
import type { GameServices } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/…).
 * - DB: prefer databaseHostToken; else in-memory GameServices.
 * - Choice middleware under `middlewares/` handles adv choice payloads (Sandbox action→text).
 * - TODO: interactive handlers (buttons still deferred).
 */
export default definePlugin({
  name: 'text-adventure',
  metadata: {
    displayName: 'Text Adventure',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      mountAdvHostServices(host);
      initGameRecordHost(host);
    } else {
      mountAdvMemoryServices();
    }
    const disposeHub = registerRuntimeGame({
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
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'adv/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale text-adventure sessions',
        async execute() {
          const services = getGameServices<GameServices>();
          if (!services?.sessions?.abortStale) return;
          await services.sessions.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
