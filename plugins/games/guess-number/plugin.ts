import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountGuessHostServices, mountGuessMemoryServices } from './src/memory-db.js';
import { gameServicesToken } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Digit middleware under `middlewares/` handles bare-number guesses.
 */
export default definePlugin({
  name: 'guess-number',
  metadata: {
    displayName: 'Guess Number',
  },
  setup(context) {
    let services: SessionService;
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      services = mountGuessHostServices(host);
      context.lifecycle.add(initGameRecordHost(host));
    } else {
      services = mountGuessMemoryServices();
    }
    context.resources.provide(gameServicesToken, services);
    const disposeHub = registerRuntimeGame({
      id: 'guess',
      title: '猜数字',
      icon: '🔢',
      description: '1~100 七步猜中神秘数',
      commandPrefix: '/猜数',
      quickStart: '开始',
      aliases: ['guess'],
      menus: [
        { id: 'start', label: '🎮 开始新局' },
        { id: 'help', label: '📖 玩法说明' },
      ],
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'guess/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale guess-number sessions',
        async execute() {
          if (!services.abortStale) return;
          await services.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
