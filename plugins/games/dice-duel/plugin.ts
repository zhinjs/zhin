import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountDiceHostServices, mountDiceMemoryServices } from './src/memory-db.js';
import { gameServicesToken } from './src/runtime-store.js';
import type { SessionService } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + start/continue/quit via in-memory DB).
 * - DB: prefer databaseHostToken; else in-memory SessionService.
 * - Choice middleware under `middlewares/` handles dice roll payloads (Sandbox action→text).
 */
export default definePlugin({
  name: 'dice-duel',
  metadata: {
    displayName: 'Dice Duel',
  },
  setup(context) {
    let services: SessionService;
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      services = mountDiceHostServices(host);
      context.lifecycle.add(initGameRecordHost(host));
    } else {
      services = mountDiceMemoryServices();
    }
    context.resources.provide(gameServicesToken, services);
    const disposeHub = registerRuntimeGame({
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
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'dice/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale dice-duel sessions',
        async execute() {
          if (!services.abortStale) return;
          await services.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
