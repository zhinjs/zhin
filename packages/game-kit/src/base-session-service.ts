import { createDeliveryTarget, DataMigrationError, encodeStorageIdentity, type DeliveryTarget, type Locale, type TargetMigrationScopes } from '@zhin.js/plugin-runtime';
import { channelKey } from './board-sender.js';
import {
  GameEventBus,
  type GameEventSession,
  type GameOutcome,
} from './game-events.js';
import type { GameSessionAvailability, GameSessionProvider } from './session-coordinator.js';

export interface BaseGameSessionRow extends GameEventSession {
  /** Captured when the game starts; legacy rows may not carry a locale. */
  locale?: Locale | null;
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

export interface GameSessionCommit<TRow extends BaseGameSessionRow> {
  readonly previous: Readonly<TRow>;
  readonly patch: Readonly<Partial<TRow>>;
  readonly where: Readonly<Record<string, unknown>>;
}
/** Resolves only after persistence commits; event publication stays in BaseSessionService. */
export type GameSessionWriter<TRow extends BaseGameSessionRow> = (request: GameSessionCommit<TRow>) => Promise<TRow | null>;

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
  readonly storageTable: string;
  #migrationScopes?: TargetMigrationScopes;
  readonly events = new GameEventBus();
  readonly #activeStatus: string;
  readonly #abortedStatus: string;
  readonly #userFields: readonly (keyof TRow & string)[];
  readonly #projectOutcomes?: BaseSessionServiceOptions<TRow>['projectOutcomes'];
  readonly #model: GameSessionModel<TRow>;
  #availability: GameSessionAvailability = { assertAvailable: async () => undefined };

  protected constructor(
    database: GameSessionDatabase<TRow>,
    options: BaseSessionServiceOptions<TRow>,
  ) {
    const model = database.models.get(options.table);
    if (!model) throw new Error(`${options.table} not registered`);
    this.#model = model;
    this.gameId = options.gameId;
    this.storageTable = options.table;
    this.#userFields = options.userFields;
    this.#projectOutcomes = options.projectOutcomes;
    this.#activeStatus = options.activeStatus ?? 'active';
    this.#abortedStatus = options.abortedStatus ?? 'aborted';
  }

  bindMigrationScopes(scopes: TargetMigrationScopes): void { this.#migrationScopes = scopes; }

  /** Whole command/timer work, including awaited notifications, shares this scope lease. */
  runInScope<T>(input: Readonly<{ scope: string; run: () => Promise<T> }>): Promise<T> {
    return this.#migrationScopes ? this.#migrationScopes.run(input) : input.run();
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
    await this.commitSession({ previous, patch, where: { id } });
  }

  /**
   * Persist one transition and emit lifecycle events from the row that was
   * actually stored. Versioned services use `where` for optimistic locking.
   */
  protected async commitSession(input: GameSessionCommit<TRow> & Readonly<{ writer?: GameSessionWriter<TRow> }>): Promise<TRow | null> {
    const { previous, where } = input;
    return this.runInScope({ scope: previous.channel_key, run: async () => {
      const patch = { ...input.patch, updated_at: Date.now() } as Partial<TRow>;
      let session: TRow | null;
      if (input.writer) session = await input.writer({ previous, where, patch });
      else {
        const changed = await this.#model.updateWhere({ ...where }, patch);
        if (typeof changed === 'number' && changed === 0) return null;
        session = await this.getById(previous.id);
      }
      if (!session) return null;
      if (patch.turn !== undefined && patch.turn !== previous.turn) {
        await this.events.emit('turn:change', {
          gameId: this.gameId,
          session,
          previousTurn: previous.turn,
          turn: patch.turn,
        });
      }
      if (patch.status !== undefined
        && previous.status === this.#activeStatus
        && patch.status !== this.#activeStatus) {
        await this.events.emit('game:end', {
          gameId: this.gameId,
          session,
          previousStatus: previous.status,
          outcomes: this.#projectOutcomes?.(session, previous) ?? [],
        });
      }
      return session;
    } });
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
      try {
        const changed = await this.runInScope({ scope: row.channel_key, run: async () => {
        // The timestamp condition prevents a cleanup scan from aborting a
        // session that received a player action after this row was selected.
        const session = await this.commitSession({
          previous: row,
          patch: { status: this.#abortedStatus } as Partial<TRow>,
          where: { id: row.id, status: this.#activeStatus, updated_at: row.updated_at },
        });
        if (!session) return false;
        await this.events.emit('session:timeout', {
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
        return true;
        } });
        if (changed) count += 1;
      } catch (error) {
        if (error instanceof DataMigrationError && error.code === 'unavailable') continue;
        throw error;
      }
    }
    return count;
  }

  bindAvailability(availability: GameSessionAvailability): void {
    this.#availability = availability;
  }

  protected assertPlayersAvailable(channelKey: string, userIds: readonly string[]): Promise<void> {
    return this.#availability.assertAvailable(this.gameId, channelKey, userIds);
  }

  protected async createRow(input: Readonly<{
    target: DeliveryTarget;
    fields: Omit<TRow, 'channel_key' | 'adapter' | 'endpoint' | 'channel_type' | 'channel_id'>;
  }>): Promise<TRow> {
    const target = createDeliveryTarget({ conversation: input.target });
    const row = { ...input.fields, adapter: encodeStorageIdentity(target.endpoint.adapter), endpoint: encodeStorageIdentity(target.endpoint.id),
      channel_type: target.kind, channel_id: encodeStorageIdentity(target.id), channel_key: channelKey({ target }) } as TRow;
    return this.runInScope({ scope: row.channel_key, run: async () => {
      const userIds: string[] = [];
      for (const field of this.#userFields) {
        const value: unknown = row[field];
        if (typeof value === 'string') userIds.push(value);
      }
      await this.assertPlayersAvailable(row.channel_key, userIds);
      await this.#model.create(row);
      await this.events.emit('game:start', { gameId: this.gameId, session: row });
      return row;
    } });
  }

  protected get model(): GameSessionModel<TRow> {
    return this.#model;
  }
}
