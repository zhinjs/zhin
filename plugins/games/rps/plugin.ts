import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountRpsHostServices, mountRpsMemoryServices } from './src/memory-db.js';
import { gameServicesToken } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles RPS choice payloads (Sandbox action→text).
 */
export default definePlugin({
  name: 'rps',
  metadata: {
    displayName: 'RPS',
  },
  setup(context) {
    let services: SessionService;
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      services = mountRpsHostServices(host);
      context.lifecycle.add(initGameRecordHost(host));
    } else {
      services = mountRpsMemoryServices();
    }
    context.resources.provide(gameServicesToken, services);
    const disposeHub = registerRuntimeGame({
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
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'rps/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale rps sessions',
        async execute() {
          if (!services.abortStale) return;
          await services.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
