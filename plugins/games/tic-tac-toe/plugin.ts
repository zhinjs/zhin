import {
  defineGamePlugin,
  gameEvents,
  plainTextFromSendContent,
  type GameEventSession,
  type InMemoryGameDb,
} from '@zhin.js/game-kit';
import { outboundHostToken } from '@zhin.js/plugin-runtime';
import { defineHostTables, type TttSessionRow } from './src/models.js';
import { gameServicesToken } from './src/runtime-store.js';
import { renderBoard } from './src/game-flow.js';
import {
  formatTurnStatus,
  formatWinHeadline,
} from './src/player-label.js';
import {
  createServices,
  type SessionServices,
  type TttDatabase,
} from './src/session-service.js';

/**
 * Plugin Runtime:
 * - Commands under `commands/` are authoritative (help + bot/join/…).
 * - DB: prefer databaseHostToken; else in-memory SessionServices.
 * - Choice middleware under `middlewares/` handles ttt grid / restart payloads (Sandbox action→text).
 */
export default defineGamePlugin<SessionServices>({
  name: 'tic-tac-toe',
  metadata: {
    displayName: 'Tic Tac Toe',
  },
  game: {
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
  },
  tables: ['ttt_sessions', 'ttt_queue', 'ttt_moves', 'ttt_spectators'],
  servicesToken: gameServicesToken,
  defineHostTables,
  createServices: (database: InMemoryGameDb) =>
    createServices(database as unknown as TttDatabase),
  session: (services) => services.session,
  setup(context, services) {
    if (!context.resources.has(outboundHostToken)) return;
    const outbound = context.resources.use(outboundHostToken);
    const notify = async (raw: GameEventSession, terminal: boolean) => {
      const session = raw as TttSessionRow;
      if (!session.adapter || !session.endpoint) return;
      const spectators = await services.session.listSpectators(session.id);
      if (spectators.length === 0) return;
      const status = session.status === 'draw'
        ? '平局。'
        : terminal && (session.winner === 1 || session.winner === 2)
          ? formatWinHeadline(session, session.winner)
          : formatTurnStatus(session, session.move_count);
      const content = plainTextFromSendContent(renderBoard({
        $adapter: session.adapter,
        $endpoint: session.endpoint,
        $channel: { type: 'private', id: '' },
        $sender: { id: '' },
      }, session, status, terminal));
      await Promise.all(spectators.map((userId) => outbound.send({
        adapter: session.adapter,
        endpointId: session.endpoint,
        conversation: { kind: 'private', id: userId },
        content,
      })));
    };
    const disposeTurn = gameEvents.on('turn:change', async (event) => {
      if (event.gameId === 'ttt' && event.session.status === 'active') {
        await notify(event.session, false);
      }
    });
    const disposeEnd = gameEvents.on('game:end', async (event) => {
      if (event.gameId === 'ttt') await notify(event.session, true);
    });
    return () => {
      disposeEnd();
      disposeTurn();
    };
  },
});
