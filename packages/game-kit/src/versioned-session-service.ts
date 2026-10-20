import {
  BaseSessionService,
  type BaseGameSessionRow,
  type BaseSessionServiceOptions,
  type GameSessionDatabase,
} from './base-session-service.js';

const DEFAULT_ACTION_HISTORY_LIMIT = 128;

export interface VersionedGameSessionRow extends BaseGameSessionRow {
  revision: number;
  /** JSON string containing the bounded action-id history. */
  processed_actions: string;
}

export interface SessionMutationOptions<TRow extends VersionedGameSessionRow> {
  readonly actionId: string;
  readonly expectedRevision?: number;
  readonly apply:
    | Partial<TRow>
    | ((session: Readonly<TRow>) =>
      Partial<TRow> | Promise<Partial<TRow>>);
}

export type SessionMutationResult<TRow extends VersionedGameSessionRow> =
  | { readonly kind: 'applied'; readonly session: TRow }
  | { readonly kind: 'duplicate'; readonly session: TRow };

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Game session "${sessionId}" does not exist.`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionRevisionConflictError extends Error {
  constructor(
    readonly sessionId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Game session "${sessionId}" changed: expected revision `
      + `${expectedRevision}, received ${actualRevision}.`,
    );
    this.name = 'SessionRevisionConflictError';
  }
}

/**
 * A keyed promise queue. It prevents lost updates inside one runtime while the
 * persisted revision check protects deployments that share a database.
 */
export class SessionActionGate {
  readonly #tails = new Map<string, Promise<void>>();

  async run<TResult>(
    sessionId: string,
    action: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => pending);
    this.#tails.set(sessionId, tail);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.#tails.get(sessionId) === tail) this.#tails.delete(sessionId);
    }
  }

  get pendingSessions(): number {
    return this.#tails.size;
  }
}

/**
 * Adds serialized, optimistic and idempotent mutations to BaseSessionService.
 * Action ids are intentionally persisted so adapter retries remain harmless
 * after a process restart.
 */
export abstract class VersionedSessionService<
  TRow extends VersionedGameSessionRow,
> extends BaseSessionService<TRow> {
  readonly #gate = new SessionActionGate();
  readonly #actionHistoryLimit: number;

  protected constructor(
    database: GameSessionDatabase<TRow>,
    options: BaseSessionServiceOptions<TRow>,
  ) {
    super(database, options);
    this.#actionHistoryLimit = DEFAULT_ACTION_HISTORY_LIMIT;
  }

  mutateSession(
    id: string,
    options: SessionMutationOptions<TRow>,
  ): Promise<SessionMutationResult<TRow>> {
    if (!options.actionId.trim()) {
      return Promise.reject(new TypeError('actionId must not be empty'));
    }
    return this.#gate.run(id, async () => {
      const previous = await this.getById(id);
      if (!previous) throw new SessionNotFoundError(id);
      const processedActions = parseActionHistory(previous.processed_actions);
      if (processedActions.includes(options.actionId)) {
        return { kind: 'duplicate', session: previous };
      }
      if (options.expectedRevision !== undefined
        && options.expectedRevision !== previous.revision) {
        throw new SessionRevisionConflictError(
          id,
          options.expectedRevision,
          previous.revision,
        );
      }

      const patch = typeof options.apply === 'function'
        ? await options.apply(previous)
        : options.apply;
      const revision = previous.revision + 1;
      const nextActions = [
        ...processedActions,
        options.actionId,
      ].slice(-this.#actionHistoryLimit);
      const session = await this.commitSession(
        previous,
        {
          ...patch,
          revision,
          processed_actions: JSON.stringify(nextActions),
        } as Partial<TRow>,
        { id, revision: previous.revision },
      );
      if (!session
        || session.revision !== revision
        || !parseActionHistory(session.processed_actions).includes(options.actionId)) {
        const actual = session?.revision
          ?? (await this.getById(id))?.revision
          ?? previous.revision;
        throw new SessionRevisionConflictError(id, previous.revision, actual);
      }
      return { kind: 'applied', session };
    });
  }
}

function parseActionHistory(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}
