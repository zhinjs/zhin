import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountBjHostServices, mountBjMemoryServices } from './src/memory-db.js';
import { gameServicesToken } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles hit/stand payloads (Sandbox action→text).
 */
export default definePlugin({
  name: 'blackjack',
  metadata: {
    displayName: 'Blackjack',
  },
  setup(context) {
    let services: SessionService;
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      services = mountBjHostServices(host);
      context.lifecycle.add(initGameRecordHost(host));
    } else {
      services = mountBjMemoryServices();
    }
    context.resources.provide(gameServicesToken, services);
    const disposeHub = registerRuntimeGame({
      id: 'blackjack',
      title: '21 点',
      icon: '🃏',
      description: '经典 Blackjack，要牌或停牌挑战庄家',
      commandPrefix: '/21点',
      quickStart: '开始',
      aliases: ['bj', '21点'],
      menus: [
        { id: 'start', label: '🎮 开始新局' },
        { id: 'help', label: '📖 玩法说明' },
      ],
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'blackjack/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale blackjack sessions',
        async execute() {
          if (!services.abortStale) return;
          await services.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
