import { definePlugin, databaseHostToken, scheduleHostToken } from '@zhin.js/plugin-runtime';
import {
  registerRuntimeGame,
  initGameRecordHost,
  DEFAULT_GAME_STALE_CRON,
  DEFAULT_GAME_STALE_IDLE_MS,
} from '@zhin.js/game-kit';
import { mountTttHostServices, mountTttMemoryServices } from './src/memory-db.js';
import { gameServicesToken } from './src/runtime-store.js';
import type { SessionServices } from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + bot/join/…).
 * - DB: prefer databaseHostToken; else in-memory SessionServices.
 * - Choice middleware under `middlewares/` handles ttt grid / restart payloads (Sandbox action→text).
 */
export default definePlugin({
  name: 'tic-tac-toe',
  metadata: {
    displayName: 'Tic Tac Toe',
  },
  setup(context) {
    let services: SessionServices;
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      services = mountTttHostServices(host);
      context.lifecycle.add(initGameRecordHost(host));
    } else {
      services = mountTttMemoryServices();
    }
    context.resources.provide(gameServicesToken, services);
    const disposeHub = registerRuntimeGame({
      id: 'ttt',
      title: '井字棋',
      icon: '♟️',
      description: '三子连珠，群聊排队或人机对战',
      commandPrefix: '/井字棋',
      quickStart: '人机',
      aliases: ['ttt'],
      menus: [
        { id: 'bot', label: '🤖 人机对战' },
        { id: 'join', label: '👥 加入排队' },
        { id: 'spectate', label: '👀 观战' },
        { id: 'help', label: '📖 玩法说明' },
      ],
    });
    context.lifecycle.add(disposeHub);

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken);
      const disposeCron = schedule.register({
        id: 'ttt/abort-stale',
        cron: DEFAULT_GAME_STALE_CRON,
        description: 'Abort stale tic-tac-toe sessions',
        async execute() {
          if (!services.session.abortStale) return;
          await services.session.abortStale(DEFAULT_GAME_STALE_IDLE_MS);
        },
      });
      context.lifecycle.add(disposeCron);
    }
  },
});
