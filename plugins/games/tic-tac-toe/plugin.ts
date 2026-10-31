import {
  defineGamePlugin,
  gameTargetFromKey,
  plainTextFromSendContent,
  type GameEventSession,
  type InMemoryGameDb,
} from '@zhin.js/game-kit';
import { outboundHostToken } from 'zhin.js';
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
    commandPath: 'ttt',
    titleI18n: { en: 'Tic-Tac-Toe' },
    descriptionI18n: { en: 'Play tic-tac-toe against the bot or another player' },
    quickStartI18n: { en: 'bot' },
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
      const spectators = await services.session.listSpectators(session.id);
      const firstSpectator = spectators[0];
      if (firstSpectator === undefined) return;
      const status = session.status === 'draw'
        ? '平局。'
        : terminal && (session.winner === 1 || session.winner === 2)
          ? formatWinHeadline(session, session.winner)
          : formatTurnStatus(session, session.move_count);
      const target = gameTargetFromKey(session.channel_key);
      if (!target) throw new Error('Historical spectator destination awaits explicit target migration');
      const privateScene = { endpoint: target.endpoint,
        kind: 'private' as const, id: firstSpectator };
      const content = plainTextFromSendContent(renderBoard({ player: { target: privateScene }, session: session, statusLine: status, terminal: terminal }));
      await Promise.all(spectators.map(async userId => {
        if (!outbound.sendTarget) throw new Error('Canonical game delivery requires an exact-target Outbound Host');
        await outbound.sendTarget({ endpoint: target.endpoint, kind: 'private', id: userId }, content);
      }));
    };
    const disposeTurn = services.session.events.on('turn:change', async (event) => {
      if (event.gameId === 'ttt' && event.session.status === 'active') {
        await notify(event.session, false);
      }
    });
    const disposeEnd = services.session.events.on('game:end', async (event) => {
      if (event.gameId === 'ttt') await notify(event.session, true);
    });
    return () => {
      disposeEnd();
      disposeTurn();
    };
  },
});
