import {
  gameEvents,
  type GameEventSession,
  type GameOutcome,
} from './game-events.js';
import { gameSessionCoordinator, type GameSessionProvider } from './session-coordinator.js';

export interface BaseGameSessionRow extends GameEventSession {
  id: string;
  channel_key: string;
  status: string;
  updated_at: number;
  created_at: number;
  turn?: unknown;
}

export interface GameSessionModel<TRow extends BaseGameSessionRow> {
  findAll(query?: Record<string, unknown>): Promise<TRow[]>;
  findOne(query?: Record<string, unknown>): Promise<TRow | null>;
  create(row: TRow): Promise<unknown>;
  updateWhere(
    where: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface GameSessionDatabase<TRow extends BaseGameSessionRow> {
  readonly models: {
    get(name: string): GameSessionModel<TRow> | undefined;
  };
}

export interface BaseSessionServiceOptions<TRow extends BaseGameSessionRow> {
  readonly gameId: string;
  readonly table: string;
  readonly userFields: readonly (keyof TRow & string)[];
  readonly activeStatus?: string;
  readonly abortedStatus?: string;
  readonly projectOutcomes?: (
    session: Readonly<TRow>,
    previous: Readonly<TRow>,
  ) => readonly GameOutcome[];
}

export type SessionTimeoutListener<TRow extends BaseGameSessionRow> = (
  session: TRow,
) => void | Promise<void>;

/**
 * Shared session lifecycle for every game. Subclasses own row construction and
 * game-specific tables; this module owns persistence invariants and events.
 */
export abstract class BaseSessionService<TRow extends BaseGameSessionRow>
implements GameSessionProvider {
  readonly gameId: string;
  readonly #activeStatus: string;
  readonly #abortedStatus: string;
  readonly #userFields: readonly (keyof TRow & string)[];
  readonly #projectOutcomes?: BaseSessionServiceOptions<TRow>['projectOutcomes'];
  readonly #model: GameSessionModel<TRow>;

  protected constructor(
    database: GameSessionDatabase<TRow>,
    options: BaseSessionServiceOptions<TRow>,
  ) {
    const model = database.models.get(options.table);
    if (!model) throw new Error(`${options.table} not registered`);
    this.#model = model;
    this.gameId = options.gameId;
    this.#userFields = options.userFields;
    this.#projectOutcomes = options.projectOutcomes;
    this.#activeStatus = options.activeStatus ?? 'active';
    this.#abortedStatus = options.abortedStatus ?? 'aborted';
  }

  async getById(id: string): Promise<TRow | null> {
    return this.#model.findOne({ id });
  }

  async getActiveByChannel(channelKey: string): Promise<TRow | null> {
    const rows = await this.#model.findAll({
      channel_key: channelKey,
      status: this.#activeStatus,
    });
    return rows[0] ?? null;
  }

  async getActiveForUser(channelKey: string, userId: string): Promise<TRow | null> {
    const rows = await this.#model.findAll({
      channel_key: channelKey,
      status: this.#activeStatus,
    });
    return rows.find((row) =>
      this.#userFields.some((field) => row[field] === userId)) ?? null;
  }

  async getLatestForUser(channelKey: string, userId: string): Promise<TRow | null> {
    const rows = await this.#model.findAll({ channel_key: channelKey });
    const matches = rows.filter((row) =>
      this.#userFields.some((field) => row[field] === userId));
    return matches.reduce<TRow | null>(
      (latest, row) => !latest || row.updated_at >= latest.updated_at ? row : latest,
      null,
    );
  }

  async updateSession(id: string, patch: Partial<TRow>): Promise<void> {
    const previous = await this.getById(id);
    if (!previous) return;
    await this.commitSession(previous, patch, { id });
  }

  /**
   * Persist one transition and emit lifecycle events from the row that was
   * actually stored. Versioned services use `where` for optimistic locking.
   */
  protected async commitSession(
    previous: TRow,
    patch: Partial<TRow>,
    where: Record<string, unknown>,
  ): Promise<TRow | null> {
    const updatedAt = Date.now();
    const changed = await this.#model.updateWhere(
      where,
      { ...patch, updated_at: updatedAt },
    );
    if (typeof changed === 'number' && changed === 0) return null;
    const session = await this.getById(previous.id);
    if (!session) return null;
    if (patch.turn !== undefined && patch.turn !== previous.turn) {
      await gameEvents.emit('turn:change', {
        gameId: this.gameId,
        session,
        previousTurn: previous.turn,
        turn: patch.turn,
      });
    }
    if (patch.status !== undefined
      && previous.status === this.#activeStatus
      && patch.status !== this.#activeStatus) {
      await gameEvents.emit('game:end', {
        gameId: this.gameId,
        session,
        previousStatus: previous.status,
        outcomes: this.#projectOutcomes?.(session, previous) ?? [],
      });
    }
    return session;
  }

  async abortStale(
    idleMs: number,
    onTimeout?: SessionTimeoutListener<TRow>,
  ): Promise<number> {
    const cutoff = Date.now() - idleMs;
    const rows = await this.#model.findAll({ status: this.#activeStatus });
    let count = 0;
    for (const row of rows) {
      if (row.updated_at >= cutoff) continue;
      // The timestamp condition prevents a cleanup scan from aborting a
      // session that received a player action after this row was selected.
      const session = await this.commitSession(
        row,
        { status: this.#abortedStatus } as Partial<TRow>,
        {
          id: row.id,
          status: this.#activeStatus,
          updated_at: row.updated_at,
        },
      );
      if (!session) continue;
      await gameEvents.emit('session:timeout', {
        gameId: this.gameId,
        session,
        idleMs,
      });
      // A broken outbound adapter must not prevent later stale sessions from
      // being finalized. Persistence and lifecycle events already succeeded.
      if (onTimeout) {
        try {
          await onTimeout(session);
        } catch {
          // Notification is best-effort; the next cleanup pass stays healthy.
        }
      }
      count += 1;
    }
    return count;
  }

  registerCoordinator(): () => void {
    return gameSessionCoordinator.register(this);
  }

  protected async createRow(row: TRow): Promise<TRow> {
    const userIds: string[] = [];
    for (const field of this.#userFields) {
      const value: unknown = row[field];
      if (typeof value === 'string') userIds.push(value);
    }
    await gameSessionCoordinator.assertAvailable(this.gameId, row.channel_key, userIds);
    await this.#model.create(row);
    await gameEvents.emit('game:start', { gameId: this.gameId, session: row });
    return row;
  }

  protected get model(): GameSessionModel<TRow> {
    return this.#model;
  }
}
