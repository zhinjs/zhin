import type { Database, Models } from '@zhin.js/core';
import {
  DeterministicRandom,
  VersionedSessionService,
  channelKey,
  gameSessionCoordinator,
  generateCompactId,
  type GameMessageLike,
  type GameOutcome,
  type GameSessionDatabase,
  type SessionMutationResult,
} from '@zhin.js/game-kit';
import {
  activePlayer,
  applyDungeonAction,
  createDungeonState,
  decodeDungeonState,
  type DungeonAction,
  type DungeonState,
} from './engine.js';
import type { DungeonSessionRow } from './models.js';

export type DungeonDatabase = Database<unknown, Models, string>;

export interface PerformDungeonActionOptions {
  readonly sessionId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: DungeonAction;
  readonly actionId: string;
  readonly expectedRevision?: number;
}

export class SessionService extends VersionedSessionService<DungeonSessionRow> {
  constructor(database: DungeonDatabase) {
    super(database as unknown as GameSessionDatabase<DungeonSessionRow>, {
      gameId: 'dungeon',
      table: 'dungeon_sessions',
      userFields: ['owner_id'],
      projectOutcomes: projectDungeonOutcomes,
    });
  }

  async createSession(
    message: GameMessageLike,
    seed?: string | number,
  ): Promise<DungeonSessionRow> {
    const now = Date.now();
    const id = generateCompactId('dng_');
    const ownerName = message.$sender.name?.trim() || message.$sender.id;
    const state = createDungeonState(message.$sender.id, ownerName);
    const random = DeterministicRandom.fromSeed(seed ?? id);
    return this.createRow({
      id,
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      owner_id: message.$sender.id,
      owner_name: ownerName,
      state_json: JSON.stringify(state),
      phase: state.phase,
      turn: activePlayer(state)?.id ?? '',
      rng_state: random.state,
      schema_version: state.schemaVersion,
      revision: 0,
      processed_actions: '[]',
      deadline_at: now + 5 * 60_000,
      status: 'active',
      updated_at: now,
      created_at: now,
    });
  }

  override async getActiveForUser(
    channelKeyValue: string,
    userId: string,
  ): Promise<DungeonSessionRow | null> {
    const rows = await this.model.findAll({
      channel_key: channelKeyValue,
      status: 'active',
    });
    return rows.find((row) =>
      decodeDungeonState(row.state_json).players.some(
        (player) => player.id === userId,
      )) ?? null;
  }

  async performAction(
    options: PerformDungeonActionOptions,
  ): Promise<SessionMutationResult<DungeonSessionRow>> {
    const existing = await this.getById(options.sessionId);
    if (!existing) {
      return this.mutateSession(options.sessionId, {
        actionId: options.actionId,
        apply: {},
      });
    }
    if (options.action.type === 'join') {
      await gameSessionCoordinator.assertAvailable(
        this.gameId,
        existing.channel_key,
        [options.actorId],
      );
    }
    return this.mutateSession(options.sessionId, {
      actionId: options.actionId,
      expectedRevision: options.expectedRevision,
      apply: (session) => {
        const state = decodeDungeonState(session.state_json);
        const random = DeterministicRandom.fromState(session.rng_state);
        const next = applyDungeonAction(
          state,
          options.actorId,
          options.action,
          random,
        );
        return {
          state_json: JSON.stringify(next),
          phase: next.phase,
          turn: activePlayer(next)?.id ?? '',
          rng_state: random.state,
          schema_version: next.schemaVersion,
          deadline_at: Date.now() + 5 * 60_000,
          status: next.phase === 'completed'
            ? next.result === 'aborted' ? 'aborted' : 'completed'
            : 'active',
        };
      },
    });
  }
}

export function createServices(database: DungeonDatabase): SessionService {
  return new SessionService(database);
}

export function stateFromSession(session: DungeonSessionRow): DungeonState {
  return decodeDungeonState(session.state_json);
}

function projectDungeonOutcomes(
  session: Readonly<DungeonSessionRow>,
): readonly GameOutcome[] {
  const state = decodeDungeonState(session.state_json);
  return state.players.map((player) => ({
    userId: player.id,
    userName: player.name,
    result: session.status === 'aborted' || state.result === 'aborted'
      ? 'aborted'
      : state.result === 'victory'
      ? player.hp > 0 ? 'won' : 'lost'
      : 'lost',
    score: state.roomsCleared * 10 + player.gold,
  }));
}
